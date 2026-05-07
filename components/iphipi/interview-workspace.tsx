/**
 * InterviewWorkspace — the live multimodal interview UI.
 *
 * Three zones:
 *   - LEFT:   Interviewer pane (avatar orb, current question, agenda, timer)
 *   - RIGHT:  Candidate pane (live webcam, mic level, transcript composer)
 *   - BOTTOM: Subtle agent-presence rail (audio listening, vision analyzing, ...)
 *
 * Lifecycle:
 *   1. PERMISSION pre-flight (camera + mic). Fails politely if denied.
 *   2. WARMUP (30s): MediaPipe loads + calibrates eye-contact baseline.
 *      Interviewer reads the opening question aloud (TTS).
 *   3. LIVE LOOP, per turn:
 *        a) Candidate clicks "Hold to speak" → STT transcribes; audio analyzer samples
 *        b) Candidate clicks "Send" (or auto-detected end) → metrics flushed
 *        c) POST /api/interview/turn → next interviewer turn streams back
 *        d) TTS speaks it → loop
 *   4. WRAP-UP: when intent === 'wrap_up' or "End interview" clicked,
 *      POST /api/interview/end → redirect to report.
 *
 * Privacy: video frames + raw audio NEVER leave the browser. We send only
 * the per-turn aggregated AudioMetrics + VisualMetrics JSON.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Mic,
  MicOff,
  Camera,
  Send,
  Loader2,
  AlertTriangle,
  Sparkles,
  Eye,
  Activity,
  Brain,
  StopCircle,
  KeyboardIcon,
  Type,
} from 'lucide-react';
import {
  AudioAnalyzer,
} from '@/lib/voice/audio-analyzer';
import {
  createRecognizer,
  speak,
  cancelSpeak,
  isSpeechRecognitionSupported,
} from '@/lib/voice/speech';
import {
  getFaceLandmarker,
  getPoseLandmarker,
  disposeMediaPipe,
} from '@/lib/vision/mediapipe-loader';
import { VisionMetricsAggregator } from '@/lib/vision/metrics-aggregator';
import type {
  AgendaItem,
  AudioMetrics,
  InterviewStatus,
  Speaker,
  VisualMetrics,
} from '@/lib/storage/types';

type DisplayedTurn = {
  id?: string;
  speaker: Speaker;
  content: string;
  intent?: string | null;
  difficulty?: number | null;
};

type Props = {
  sessionId: string;
  targetRole: string;
  agenda: AgendaItem[];
  initialTurns: DisplayedTurn[];
  sessionStatus: InterviewStatus;
};

type Phase = 'preflight' | 'warmup' | 'live' | 'ending' | 'completed' | 'error';

export function InterviewWorkspace({
  sessionId,
  targetRole,
  agenda,
  initialTurns,
  sessionStatus,
}: Props) {
  const router = useRouter();

  /* ---------------- state ---------------- */
  const [phase, setPhase] = useState<Phase>(
    sessionStatus === 'completed' ? 'completed' : 'preflight'
  );
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<DisplayedTurn[]>(initialTurns);

  // Latest agent turn drives the interviewer pane
  const latestAgentTurn =
    [...turns].reverse().find((t) => t.speaker === 'agent') ?? null;

  const [recording, setRecording] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [composedText, setComposedText] = useState('');
  const [textOnly, setTextOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [agentPresence, setAgentPresence] = useState({
    audio: false,
    visual: false,
    technical: false,
  });

  const [timeRemaining, setTimeRemaining] = useState<number>(12);

  /* ---------------- refs ---------------- */
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const visionAggRef = useRef<VisionMetricsAggregator>(new VisionMetricsAggregator());
  const recognizerRef = useRef<ReturnType<typeof createRecognizer> | null>(null);
  const mediapipeLoopRef = useRef<number | null>(null);
  const finalTranscriptRef = useRef<string>('');

  /* ---------------- pre-flight ---------------- */
  const requestPermissions = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {/* autoplay may need user gesture */});
      }
      setPhase('warmup');
      void runWarmup();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Camera/mic permission denied: ${err.message}`
          : 'Camera/mic permission denied'
      );
      setPhase('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- warmup: load MediaPipe + speak opening ---------------- */
  const runWarmup = useCallback(async () => {
    try {
      // Load CV models in parallel with the opening TTS
      const cvPromise = Promise.all([getFaceLandmarker(), getPoseLandmarker()]);
      const opening = latestAgentTurn?.content ?? '';
      await Promise.all([cvPromise, opening ? speak(opening) : Promise.resolve()]);

      // Calibrate eye contact baseline using current nose position.
      try {
        const fl = await getFaceLandmarker();
        if (videoRef.current) {
          const r = fl.detectForVideo(videoRef.current, performance.now());
          const nose = r.faceLandmarks?.[0]?.[1];
          if (nose) visionAggRef.current.calibrateEyeContactBaseline(nose.x);
        }
      } catch {
        // calibration is best-effort
      }

      // Begin the per-frame CV loop (always-on through the interview)
      startMediaPipeLoop();
      setPhase('live');
    } catch (err) {
      setError(
        err instanceof Error
          ? `Warmup failed: ${err.message}`
          : 'Warmup failed'
      );
      setPhase('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestAgentTurn]);

  /* ---------------- always-on MediaPipe frame loop ---------------- */
  const startMediaPipeLoop = useCallback(() => {
    let last = -1;
    const tick = async (ts: number) => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        mediapipeLoopRef.current = requestAnimationFrame(tick);
        return;
      }
      // Throttle to ~15 FPS to keep CPU happy
      if (ts - last < 66) {
        mediapipeLoopRef.current = requestAnimationFrame(tick);
        return;
      }
      last = ts;
      try {
        const fl = await getFaceLandmarker();
        const pl = await getPoseLandmarker();
        const v = videoRef.current;
        const tNow = performance.now();
        const faceR = fl.detectForVideo(v, tNow);
        const poseR = pl.detectForVideo(v, tNow);
        visionAggRef.current.observeFace(faceR);
        visionAggRef.current.observePose(poseR);
        // Pulse the visual presence light
        setAgentPresence((p) => ({ ...p, visual: true }));
      } catch {
        // best-effort per-frame
      }
      mediapipeLoopRef.current = requestAnimationFrame(tick);
    };
    mediapipeLoopRef.current = requestAnimationFrame(tick);
  }, []);

  /* ---------------- recording lifecycle ---------------- */
  const startRecording = useCallback(async () => {
    if (!streamRef.current) return;
    setComposedText('');
    setPartialTranscript('');
    finalTranscriptRef.current = '';

    setAgentPresence((p) => ({ ...p, audio: true }));

    // Start audio analyzer
    audioAnalyzerRef.current = new AudioAnalyzer();
    await audioAnalyzerRef.current.start(streamRef.current);

    // Start STT (if supported)
    if (isSpeechRecognitionSupported()) {
      try {
        recognizerRef.current = createRecognizer({
          onPartial: (t) => setPartialTranscript(t),
          onFinal: (t) => {
            finalTranscriptRef.current = (
              finalTranscriptRef.current +
              ' ' +
              t
            ).trim();
            setComposedText(finalTranscriptRef.current);
            setPartialTranscript('');
          },
          onError: () => {/* swallow — text fallback always available */},
        });
        recognizerRef.current.start();
      } catch {
        // STT unsupported — text-only mode
        setTextOnly(true);
      }
    }

    setRecording(true);
  }, []);

  const stopRecording = useCallback((): AudioMetrics | null => {
    setRecording(false);
    setAgentPresence((p) => ({ ...p, audio: false }));
    try {
      recognizerRef.current?.stop();
    } catch {
      // ignore
    }
    recognizerRef.current = null;

    if (!audioAnalyzerRef.current) return null;
    const transcript = finalTranscriptRef.current || partialTranscript || composedText;
    const m = audioAnalyzerRef.current.stop(transcript);
    audioAnalyzerRef.current = null;
    return m;
  }, [composedText, partialTranscript]);

  /* ---------------- submit a turn ---------------- */
  const submitTurn = useCallback(async () => {
    const text = (composedText || finalTranscriptRef.current || partialTranscript).trim();
    if (!text) return;

    setSubmitting(true);
    setAgentPresence({ audio: false, visual: true, technical: true });

    // If still recording, stop and capture audio metrics
    let audioMetrics: AudioMetrics | null = null;
    if (recording) audioMetrics = stopRecording();

    // Flush vision aggregator for this turn
    const visualMetrics: VisualMetrics = visionAggRef.current.flush();

    // Optimistically render the candidate turn
    setTurns((prev) => [
      ...prev,
      { speaker: 'candidate', content: text },
    ]);

    try {
      const r = await fetch('/api/interview/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          candidateText: text,
          audioMetrics,
          visualMetrics,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.message || data.error || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as {
        agentTurn: { id: string; content: string; intent: string; difficulty: number };
        timeBudgetMinutes: number;
        isWrapUp: boolean;
      };

      setTurns((prev) => [
        ...prev,
        {
          id: data.agentTurn.id,
          speaker: 'agent',
          content: data.agentTurn.content,
          intent: data.agentTurn.intent,
          difficulty: data.agentTurn.difficulty,
        },
      ]);
      setTimeRemaining(data.timeBudgetMinutes);
      setComposedText('');
      setPartialTranscript('');
      finalTranscriptRef.current = '';
      setAgentPresence({ audio: false, visual: true, technical: false });

      // Speak the next interviewer question
      void speak(data.agentTurn.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [composedText, partialTranscript, recording, sessionId, stopRecording]);

  /* ---------------- end the interview ---------------- */
  const endInterview = useCallback(async () => {
    setPhase('ending');
    cancelSpeak();
    try {
      const r = await fetch('/api/interview/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      router.push(`/interview/${sessionId}/report`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('live');
    }
  }, [router, sessionId]);

  /* ---------------- cleanup ---------------- */
  useEffect(() => {
    return () => {
      cancelSpeak();
      if (mediapipeLoopRef.current) cancelAnimationFrame(mediapipeLoopRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        recognizerRef.current?.abort();
      } catch {
        // ignore
      }
      disposeMediaPipe();
    };
  }, []);

  /* ============================================================ render */
  if (phase === 'completed') return <CompletedView sessionId={sessionId} />;
  if (phase === 'preflight') {
    return (
      <PreflightView
        targetRole={targetRole}
        agenda={agenda}
        onStart={requestPermissions}
        error={error}
      />
    );
  }
  if (phase === 'warmup') return <WarmupView videoRef={videoRef} />;

  if (phase === 'ending') {
    return (
      <CenteredCard>
        <Loader2 className="h-10 w-10 animate-spin text-brand-300" />
        <h2 className="mt-6 text-xl font-semibold">Generating your report…</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Agent 6 is aggregating every signal from the session.
        </p>
      </CenteredCard>
    );
  }

  return (
    <main className="mx-auto flex h-screen max-w-7xl flex-col px-6 py-6">
      <TopBar
        targetRole={targetRole}
        agenda={agenda}
        progress={Math.min(turns.length, agenda.length * 2)}
        timeRemaining={timeRemaining}
        onEnd={endInterview}
      />

      {/* Main grid */}
      <div className="mt-6 grid flex-1 gap-6 lg:grid-cols-[1fr_420px]">
        <InterviewerPane turn={latestAgentTurn} agentPresence={agentPresence} />
        <CandidatePane
          videoRef={videoRef}
          recording={recording}
          partialTranscript={partialTranscript}
          composedText={composedText}
          setComposedText={setComposedText}
          textOnly={textOnly}
          setTextOnly={setTextOnly}
          submitting={submitting}
          onStartRecording={startRecording}
          onStopRecording={() => stopRecording()}
          onSubmit={submitTurn}
        />
      </div>

      <PresenceRail presence={agentPresence} />

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/5 p-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}
    </main>
  );
}

/* ============================================================ subviews */

function PreflightView({
  targetRole,
  agenda,
  onStart,
  error,
}: {
  targetRole: string;
  agenda: AgendaItem[];
  onStart: () => void;
  error: string | null;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6">
      <div className="glass-strong w-full p-10 text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-brand-300" />
          {targetRole} · Multimodal mock interview
        </div>
        <h1 className="mt-6 text-balance text-3xl font-semibold tracking-tight">
          Ready to begin?
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          We'll need access to your <strong className="text-foreground">camera</strong> and{' '}
          <strong className="text-foreground">microphone</strong>. Your video is processed
          entirely on your device — only summary scores are sent to our server.
        </p>

        <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-5 text-left">
          <div className="text-xs uppercase tracking-wider text-brand-300">
            Today's agenda · ~{agenda.reduce((s, a) => s + a.estimatedMinutes, 0)} min
          </div>
          <ol className="mt-3 space-y-1.5 text-sm">
            {agenda.map((a, i) => (
              <li key={i} className="text-foreground/85">
                <span className="font-mono text-xs text-muted-foreground">
                  {String(i + 1).padStart(2, '0')}
                </span>{' '}
                {a.topic}
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-8">
          <Button size="lg" onClick={onStart} className="gap-2">
            <Camera className="h-4 w-4" />
            Allow camera & mic
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Use Chrome or Edge for best results.
          </p>
        </div>
        {error && (
          <div className="mt-6 flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/5 p-3 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}
      </div>
    </main>
  );
}

function WarmupView({
  videoRef,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6">
      <div className="glass-strong overflow-hidden rounded-2xl">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-[360px] w-[480px] -scale-x-100 object-cover"
        />
      </div>
      <div className="text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand-300" />
        <h2 className="mt-3 text-xl font-semibold">Calibrating…</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Loading vision models, calibrating eye-contact baseline, and
          letting the interviewer say hello. This takes about 5 seconds.
        </p>
      </div>
    </main>
  );
}

function CompletedView({ sessionId }: { sessionId: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6">
      <CenteredCard>
        <h2 className="text-xl font-semibold">This interview is complete.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          View the report below.
        </p>
        <a
          href={`/interview/${sessionId}/report`}
          className="mt-6 inline-block rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white"
        >
          Open report
        </a>
      </CenteredCard>
    </main>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-strong w-full max-w-md p-10 text-center">{children}</div>
  );
}

/* ----- Top bar with agenda progress + timer + end button ----- */

function TopBar({
  targetRole,
  agenda,
  progress,
  timeRemaining,
  onEnd,
}: {
  targetRole: string;
  agenda: AgendaItem[];
  progress: number;
  timeRemaining: number;
  onEnd: () => void;
}) {
  const totalSlots = agenda.length * 2; // each agenda item is roughly 1 question + 1 follow-up
  const pct = Math.min(100, (progress / totalSlots) * 100);
  return (
    <div className="glass flex items-center justify-between gap-4 px-5 py-3">
      <div>
        <div className="text-xs uppercase tracking-wider text-brand-300">
          Live interview
        </div>
        <div className="mt-0.5 text-sm font-semibold">{targetRole}</div>
      </div>
      <div className="hidden flex-1 items-center gap-3 sm:flex">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="font-mono text-xs tabular-nums text-muted-foreground">
          {Math.max(0, timeRemaining).toFixed(1)}m left
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onEnd} className="gap-1.5">
        <StopCircle className="h-3.5 w-3.5" /> End & see report
      </Button>
    </div>
  );
}

/* ----- Interviewer pane ----- */

function InterviewerPane({
  turn,
  agentPresence,
}: {
  turn: DisplayedTurn | null;
  agentPresence: { audio: boolean; visual: boolean; technical: boolean };
}) {
  return (
    <section className="glass-strong relative flex flex-col p-8">
      {/* Avatar orb */}
      <div className="flex items-center gap-4">
        <div className="relative flex h-14 w-14 items-center justify-center">
          <div
            className={
              'absolute inset-0 rounded-full bg-gradient-to-br from-brand-400 to-brand-700 ' +
              (agentPresence.audio ? 'animate-pulse' : '')
            }
          />
          <Sparkles className="relative h-6 w-6 text-white" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-brand-300">
            Interviewer
          </div>
          <div className="text-sm font-medium">
            {turn?.intent && intentLabel(turn.intent)}{' '}
            {turn?.difficulty && (
              <span className="ml-2 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                difficulty {turn.difficulty}/5
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Question */}
      <div className="mt-8 flex flex-1 items-start">
        <p className="text-balance text-2xl leading-relaxed text-foreground/95">
          {turn?.content ?? 'Preparing your first question…'}
        </p>
      </div>
    </section>
  );
}

function intentLabel(intent: string): string {
  switch (intent) {
    case 'probe_deeper': return 'Going deeper';
    case 'switch_topic': return 'New topic';
    case 'drop_difficulty': return 'Reset';
    case 'ramp_difficulty': return 'Stretching';
    case 'clarify': return 'Clarifying';
    case 'encourage': return 'Encouraging';
    case 'wrap_up': return 'Wrapping up';
    default: return intent;
  }
}

/* ----- Candidate pane ----- */

function CandidatePane({
  videoRef,
  recording,
  partialTranscript,
  composedText,
  setComposedText,
  textOnly,
  setTextOnly,
  submitting,
  onStartRecording,
  onStopRecording,
  onSubmit,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  recording: boolean;
  partialTranscript: string;
  composedText: string;
  setComposedText: (s: string) => void;
  textOnly: boolean;
  setTextOnly: (b: boolean) => void;
  submitting: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSubmit: () => void;
}) {
  const displayText = composedText || partialTranscript;

  return (
    <aside className="glass flex flex-col gap-4 p-5">
      {/* Webcam */}
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/40">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-[200px] w-full -scale-x-100 object-cover"
        />
        <div className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Local only
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] p-1 text-xs">
        <button
          onClick={() => setTextOnly(false)}
          className={
            'flex-1 rounded-md px-2 py-1.5 transition ' +
            (!textOnly ? 'bg-white/[0.08] text-foreground' : 'text-muted-foreground')
          }
        >
          <Mic className="mr-1 inline h-3 w-3" /> Voice
        </button>
        <button
          onClick={() => setTextOnly(true)}
          className={
            'flex-1 rounded-md px-2 py-1.5 transition ' +
            (textOnly ? 'bg-white/[0.08] text-foreground' : 'text-muted-foreground')
          }
        >
          <Type className="mr-1 inline h-3 w-3" /> Type
        </button>
      </div>

      {/* Composer */}
      <textarea
        value={displayText}
        onChange={(e) => setComposedText(e.target.value)}
        placeholder={
          textOnly
            ? 'Type your answer here…'
            : recording
            ? 'Listening… speak naturally.'
            : 'Click "Hold to speak" or switch to typing.'
        }
        disabled={submitting}
        rows={5}
        className="min-h-[120px] resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-brand-400/50 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
      />

      {/* Action row */}
      <div className="flex gap-2">
        {!textOnly && (
          <Button
            variant={recording ? 'default' : 'secondary'}
            size="md"
            className="flex-1"
            onClick={recording ? onStopRecording : onStartRecording}
            disabled={submitting}
          >
            {recording ? (
              <>
                <MicOff className="h-4 w-4" /> Stop
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" /> Speak
              </>
            )}
          </Button>
        )}
        <Button
          size="md"
          className={textOnly ? 'flex-1' : ''}
          onClick={onSubmit}
          disabled={submitting || (!composedText && !partialTranscript)}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Sending
            </>
          ) : (
            <>
              <Send className="h-4 w-4" /> Send
            </>
          )}
        </Button>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        <KeyboardIcon className="mr-1 inline h-3 w-3" />
        Edit your transcript before sending. Voice is best in Chrome / Edge.
      </p>
    </aside>
  );
}

/* ----- Bottom presence rail ----- */

function PresenceRail({
  presence,
}: {
  presence: { audio: boolean; visual: boolean; technical: boolean };
}) {
  const items = [
    { id: 'audio', label: 'Audio listening', icon: Activity, on: presence.audio },
    { id: 'visual', label: 'Vision analyzing', icon: Eye, on: presence.visual },
    { id: 'technical', label: 'Tech evaluating', icon: Brain, on: presence.technical },
  ];
  return (
    <div className="mt-4 flex items-center justify-center gap-6 text-xs text-muted-foreground">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div
            key={it.id}
            className={
              'inline-flex items-center gap-1.5 transition ' +
              (it.on ? 'text-foreground' : '')
            }
          >
            <span
              className={
                'block h-1.5 w-1.5 rounded-full ' +
                (it.on ? 'animate-pulse bg-brand-400' : 'bg-white/15')
              }
            />
            <Icon className="h-3 w-3" /> {it.label}
          </div>
        );
      })}
    </div>
  );
}
