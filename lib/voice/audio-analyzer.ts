/**
 * Audio Analyzer — browser-side, runs during a candidate's turn.
 *
 * Uses Web Audio API to compute per-turn signals:
 *   - WPM (from the transcript + duration)
 *   - filler-word count ("um", "uh", "like", "you know")
 *   - pause ratio + silence percentage (RMS-based)
 *   - pitch mean + variance (autocorrelation)
 *   - volume RMS mean + variance
 *
 * Lifecycle:
 *   const a = new AudioAnalyzer();
 *   await a.start(stream);                 // begin sampling
 *   const m = a.stop(transcript);          // returns AudioMetrics
 *
 * Sampling cadence: ~50ms windows. Numbers are rough but cheap and useful
 * enough to give the LLM scoring agent something concrete to ground in.
 */
import type { AudioMetrics } from '@/lib/storage/types';

const SAMPLE_INTERVAL_MS = 50;
const SILENCE_RMS_THRESHOLD = 0.012;
const PAUSE_LENGTH_MS = 500;
const FILLER_RX = /\b(um|uh|hmm+|er+|like|you\s+know)\b/gi;

export class AudioAnalyzer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private rms: number[] = [];
  private pitches: number[] = [];
  private startTs = 0;
  private silentSinceTs: number | null = null;
  private pauseCount = 0;

  async start(stream: MediaStream): Promise<void> {
    this.reset();
    this.startTs = Date.now();

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

  stop(transcript: string): AudioMetrics {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    try {
      this.source?.disconnect();
      this.analyser?.disconnect();
      this.ctx?.close();
    } catch {
      // best-effort teardown
    }

    const durationMs = Math.max(1, Date.now() - this.startTs);
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

  private reset() {
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
    this.rms.push(rms);

    // Pause detection (a continuous silent stretch ≥ PAUSE_LENGTH_MS counts as 1 pause)
    const now = Date.now();
    if (rms < SILENCE_RMS_THRESHOLD) {
      if (this.silentSinceTs === null) this.silentSinceTs = now;
      else if (now - this.silentSinceTs >= PAUSE_LENGTH_MS) {
        this.pauseCount++;
        this.silentSinceTs = now + 99999; // dampen — don't re-count until we hear sound again
      }
    } else {
      this.silentSinceTs = null;
    }

    // Pitch via autocorrelation — only sample when we actually have signal
    if (rms > SILENCE_RMS_THRESHOLD * 2 && this.ctx) {
      const f0 = autocorrelate(buf, this.ctx.sampleRate);
      if (f0 > 60 && f0 < 400) this.pitches.push(f0);
    }
  }
}

/* ----- helpers ----- */

/**
 * Simple time-domain autocorrelation pitch detector.
 * Adequate for human voice (~80-300 Hz). Returns -1 on no clear pitch.
 */
function autocorrelate(buf: Float32Array<ArrayBufferLike>, sampleRate: number): number {
  const SIZE = buf.length;
  let bestOffset = -1;
  let bestCorrelation = 0;
  let lastCorrelation = 1;
  // Look at lags 80-1000 samples (covers ~22-550 Hz at 44.1k; plenty for voice)
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
