/**
 * AudioAnalyzer — always-on browser audio sampler with VAD + per-turn metrics.
 *
 * Two modes layered on the same Web Audio pipeline:
 *
 *  1. ALWAYS-ON callbacks (bound at start()):
 *     - onLevel(rms)         every ~50ms — drives the live waveform UI
 *     - onSpeechStart()      fired once when voice activity begins
 *     - onSpeechEnd()        fired once when voice activity ends (after a
 *                            sustained silence threshold)
 *     This lets us run hands-free: the UI auto-records when the candidate
 *     speaks and auto-submits when they finish.
 *
 *  2. PER-TURN metric segments:
 *     - beginTurn()          mark the start of a candidate turn
 *     - endTurn(transcript)  → AudioMetrics for everything since beginTurn
 *
 *  Lifecycle:
 *    const a = new AudioAnalyzer();
 *    await a.start(stream, callbacks);   // begin always-on sampling
 *    a.beginTurn();                       // ... user starts speaking ...
 *    const metrics = a.endTurn(text);     // ... user stopped, submit
 *    a.stop();                            // tear down at session end
 */
import type { AudioMetrics } from '@/lib/storage/types';

const SAMPLE_INTERVAL_MS = 50;
const SILENCE_RMS_THRESHOLD = 0.012;
const VAD_SPEAK_RMS = 0.030;       // moderate floor — catches quiet speech but not room hum
const VAD_SPEAK_HOLD_MS = 180;     // quick start (~3 frames at 50ms)
const VAD_SILENCE_HOLD_MS = 900;   // ~0.9s pause after talking → auto-submit
const PAUSE_LENGTH_MS = 500;
const FILLER_RX = /\b(um|uh|hmm+|er+|like|you\s+know)\b/gi;

export type AudioCallbacks = {
  onLevel?: (rms: number) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
};

export class AudioAnalyzer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private callbacks: AudioCallbacks = {};

  // Always-on running aggregates of recent samples
  private lastFireSpeech = 0;       // when VAD last fired onSpeechStart (debounce)
  private speakingNow = false;
  private speakStartedTs: number | null = null;
  private silenceStartedTs: number | null = null;

  // Per-turn windowed buffers
  private turnActive = false;
  private turnStartTs = 0;
  private rms: number[] = [];
  private pitches: number[] = [];
  private silentSinceTs: number | null = null;
  private pauseCount = 0;

  async start(stream: MediaStream, callbacks: AudioCallbacks = {}): Promise<void> {
    this.callbacks = callbacks;
    this.resetTurn();

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new AudioCtx();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source.connect(this.analyser);

    const buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.timer = setInterval(() => this.sample(buf), SAMPLE_INTERVAL_MS);
  }

  /** Mark the beginning of a new candidate turn. Per-turn metrics reset. */
  beginTurn(): void {
    this.resetTurn();
    this.turnActive = true;
    this.turnStartTs = Date.now();
  }

  /** Produce AudioMetrics for the current turn and end the turn. */
  endTurn(transcript: string): AudioMetrics {
    this.turnActive = false;
    const durationMs = Math.max(1, Date.now() - this.turnStartTs);
    const durationSec = durationMs / 1000;

    const rmsMean = mean(this.rms);
    const rmsVar = variance(this.rms);
    const silentSamples = this.rms.filter((r) => r < SILENCE_RMS_THRESHOLD).length;
    const silencePct = this.rms.length === 0 ? 0 : silentSamples / this.rms.length;
    const pauseRatio = clamp(
      (this.pauseCount * PAUSE_LENGTH_MS) / durationMs,
      0,
      1
    );

    const validPitches = this.pitches.filter((p) => p > 60 && p < 400);
    const pitchMean = mean(validPitches);
    const pitchVar = variance(validPitches);

    const words = (transcript.trim().match(/\S+/g) ?? []).length;
    const wpm = (words / durationSec) * 60;
    const fillers = (transcript.match(FILLER_RX) ?? []).length;
    const fillersPerMin = (fillers / durationSec) * 60;

    return {
      wpm: round1(wpm),
      fillers_per_min: round1(fillersPerMin),
      pause_ratio: round2(pauseRatio),
      pitch_mean_hz: round1(pitchMean),
      pitch_variance: round1(pitchVar),
      rms_mean: round3(rmsMean),
      rms_variance: round3(rmsVar),
      silence_pct: round2(silencePct),
    };
  }

  /** Tear down the analyzer and release the audio context. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.source?.disconnect();
      this.analyser?.disconnect();
      this.ctx?.close();
    } catch {
      /* best-effort */
    }
    this.callbacks = {};
  }

  private resetTurn() {
    this.rms = [];
    this.pitches = [];
    this.silentSinceTs = null;
    this.pauseCount = 0;
  }

  private sample(buf: Float32Array<ArrayBuffer>) {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(buf);

    // RMS
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
    const rms = Math.sqrt(sumSq / buf.length);

    // Always: notify level for live UI
    try {
      this.callbacks.onLevel?.(rms);
    } catch {
      /* swallow callback errors */
    }

    // Always: VAD edge detection
    this.advanceVad(rms);

    // Per-turn (only when a turn is active): RMS, pause count, pitch
    if (this.turnActive) {
      this.rms.push(rms);

      const now = Date.now();
      if (rms < SILENCE_RMS_THRESHOLD) {
        if (this.silentSinceTs === null) this.silentSinceTs = now;
        else if (now - this.silentSinceTs >= PAUSE_LENGTH_MS) {
          this.pauseCount++;
          this.silentSinceTs = now + 99999; // dampen
        }
      } else {
        this.silentSinceTs = null;
      }

      if (rms > SILENCE_RMS_THRESHOLD * 2 && this.ctx) {
        const f0 = autocorrelate(buf, this.ctx.sampleRate);
        if (f0 > 60 && f0 < 400) this.pitches.push(f0);
      }
    }
  }

  private advanceVad(rms: number) {
    const now = Date.now();
    const above = rms > VAD_SPEAK_RMS;

    if (!this.speakingNow) {
      // Looking for the start of speech
      if (above) {
        if (this.speakStartedTs === null) this.speakStartedTs = now;
        else if (now - this.speakStartedTs >= VAD_SPEAK_HOLD_MS) {
          this.speakingNow = true;
          this.silenceStartedTs = null;
          this.speakStartedTs = null;
          // Debounce — don't refire start if we just ended very recently
          if (now - this.lastFireSpeech > 300) {
            this.lastFireSpeech = now;
            try {
              this.callbacks.onSpeechStart?.();
            } catch {
              /* swallow */
            }
          }
        }
      } else {
        this.speakStartedTs = null;
      }
    } else {
      // Looking for the end of speech (sustained silence)
      if (!above) {
        if (this.silenceStartedTs === null) this.silenceStartedTs = now;
        else if (now - this.silenceStartedTs >= VAD_SILENCE_HOLD_MS) {
          this.speakingNow = false;
          this.silenceStartedTs = null;
          this.speakStartedTs = null;
          this.lastFireSpeech = now;
          try {
            this.callbacks.onSpeechEnd?.();
          } catch {
            /* swallow */
          }
        }
      } else {
        this.silenceStartedTs = null;
      }
    }
  }
}

/* ------------- helpers ------------- */

function autocorrelate(
  buf: Float32Array<ArrayBufferLike>,
  sampleRate: number
): number {
  const SIZE = buf.length;
  let bestOffset = -1;
  let bestCorrelation = 0;
  let lastCorrelation = 1;
  for (let offset = 32; offset < 1000; offset++) {
    let correlation = 0;
    for (let i = 0; i < SIZE - offset; i++) {
      correlation += buf[i] * buf[i + offset];
    }
    correlation = correlation / (SIZE - offset);
    if (correlation > 0.9 && correlation > lastCorrelation) {
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    } else if (bestCorrelation > 0.9) {
      break;
    }
    lastCorrelation = correlation;
  }
  return bestOffset > 0 ? sampleRate / bestOffset : -1;
}

function mean(a: number[]): number {
  return a.length === 0 ? 0 : a.reduce((s, n) => s + n, 0) / a.length;
}
function variance(a: number[]): number {
  if (a.length === 0) return 0;
  const m = mean(a);
  return a.reduce((s, n) => s + (n - m) ** 2, 0) / a.length;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
