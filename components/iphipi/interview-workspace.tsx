/**
 * InterviewWorkspace — hands-free multimodal interview UI.
 *
 * Design goals (post-feedback):
 *   - Webcam is BIG and always visible with a live face-mesh overlay so the
 *     candidate can see the vision model is doing its job.
 *   - HANDS-FREE flow: voice activity detection auto-records when the
 *     candidate speaks and auto-submits after 1.5s of silence. No mic button.
 *   - Live audio waveform + live engagement / eye-contact gauges so the
 *     candidate can feel the agents working in real time.
 *   - "Type instead" toggle and "Pause" controls remain for accessibility.
 *
 * Lifecycle phases:
 *   preflight  → camera/mic permission gate + agenda preview
 *   warmup     → MediaPipe loads + interviewer greets (TTS) + eye-contact baseline
 *   live       → conversational loop (auto VAD / TTS / per-turn agents)
 *   ending     → /api/interview/end → /report
 *   completed  → "view report" link
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Camera,
  Send,
  Loader2,
  AlertTriangle,
  Sparkles,
  StopCircle,
  Pause,
  Play,
  Type,
  Mic,
} from 'lucide-react';
import { AudioAnalyzer } from '@/lib/voice/audio-analyzer';
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
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';

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

/** Conversational state inside the live phase. */
type LiveState =
  | 'ai_speaking'   // TTS is reading the latest interviewer turn
  | 'listening'     // mic is hot, waiting for the candidate to start speaking
  | 'recording'     // VAD detected speech; capturing transcript + metrics
  | 'submitting'    // POST /api/interview/turn in flight
  | 'paused';       // candidate hit pause — no auto VAD

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

  const latestAgentTurn =
    [...turns].reverse().find((t) => t.speaker === 'agent') ?? null;

  const [liveState, setLiveState] = useState<LiveState>('ai_speaking');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [composedText, setComposedText] = useState('');
  const [textOnly, setTextOnly] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  // Live gauge values (smoothed, updated every animation frame)
  const [gauges, setGauges] = useState({ eyeContact: 0, engagement: 0, posture: 0 });

  const [timeRemaining, setTimeRemaining] = useState<number>(12);

  /* ---------------- refs ---------------- */
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const visionAggRef = useRef<VisionMetricsAggregator>(new VisionMetricsAggregator());
  const recognizerRef = useRef<ReturnType<typeof createRecognizer> | null>(null);
  const mediapipeLoopRef = useRef<number | null>(null);
  const finalTranscriptRef = useRef<string>('');
  const liveStateRef = useRef<LiveState>('ai_speaking'); // mirror for callbacks
  const lastFaceResultRef = useRef<FaceLandmarkerResult | null>(null);

  // Keep liveStateRef in sync with state (callbacks need the latest)
  useEffect(() => {
    liveStateRef.current = liveState;
  }, [liveState]);

  /* ---------------- attach the stream to the video element ---------------- */
  /* CRITICAL: phase changes re-mount the video element. We re-attach
     streamRef.current any time the video element appears with no stream. */
  useEffect(() => {
    if (phase === 'warmup' || phase === 'live') {
      const v = videoRef.current;
      if (v && streamRef.current && v.srcObject !== streamRef.current) {
        v.srcObject = streamRef.current;
        v.play().catch(() => {/* autoplay may need a gesture; webcam works on permission grant */});
      }
    }
  }, [phase]);

  /* ---------------- pre-flight ---------------- */
  const requestPermissions = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
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

  /* ---------------- warmup ---------------- */
  const runWarmup = useCallback(async () => {
    try {
      // Load CV models in parallel with TTS greeting
      await Promise.all([getFaceLandmarker(), getPoseLandmarker()]);

      // Calibrate eye-contact baseline using current nose position
      try {
        const fl = await getFaceLandmarker();
        if (videoRef.current) {
          const r = fl.detectForVideo(videoRef.current, performance.now());
          const nose = r.faceLandmarks?.[0]?.[1];
          if (nose) visionAggRef.current.calibrateEyeContactBaseline(nose.x);
        }
      } catch {
        /* best-effort */
      }

      // Begin always-on MediaPipe loop
      startMediaPipeLoop();

      // Begin always-on AudioAnalyzer with VAD callbacks
      if (streamRef.current) {
        audioAnalyzerRef.current = new AudioAnalyzer();
        await audioAnalyzerRef.current.start(streamRef.current, {
          onLevel: (rms) => setMicLevel(rms),
          onSpeechStart: () => onVadSpeechStart(),
          onSpeechEnd: () => onVadSpeechEnd(),
        });
      }

      setPhase('live');
      // Speak the opening turn
      if (latestAgentTurn?.content) {
        await speak(latestAgentTurn.content);
      }
      // After TTS finishes, drop into listening mode
      setLiveState('listening');
    } catch (err) {
      setError(err instanceof Error ? `Warmup failed: ${err.message}` : 'Warmup failed');
      setPhase('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestAgentTurn]);

  /* ---------------- always-on MediaPipe loop ---------------- */
  const startMediaPipeLoop = useCallback(() => {
    let last = -1;
    let lastGaugeUpdate = 0;
    const tick = async (ts: number) => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        mediapipeLoopRef.current = requestAnimationFrame(tick);
        return;
      }
      // ~15 FPS for inference
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
        lastFaceResultRef.current = faceR;

        // Draw the face mesh overlay
        drawFaceMesh(overlayRef.current, videoRef.current, faceR);

        // Update live gauges every ~250ms (cheap)
        if (ts - lastGaugeUpdate > 250) {
          lastGaugeUpdate = ts;
          setGauges(visionAggRef.current.snapshot());
        }
      } catch {
        /* per-frame failures are fine */
      }
      mediapipeLoopRef.current = requestAnimationFrame(tick);
    };
    mediapipeLoopRef.current = requestAnimationFrame(tick);
  }, []);

  /* ---------------- speech recognizer lifecycle ---------------- */

  /**
   * Start the SpeechRecognition the MOMENT we enter `listening` — not when
   * VAD fires. SpeechRecognition itself takes 200-500ms to actually capture
   * audio; if we wait for VAD, the first words of every answer are lost.
   *
   * We let the recognizer accumulate a transcript across both `listening`
   * and `recording` states; VAD only signals when to STOP and submit.
   */
  const startRecognizer = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      setTextOnly(true);
      return;
    }
    if (recognizerRef.current) return; // already running
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
        onError: (err) => {
          // SpeechRecognition can throw "no-speech" or "aborted"; usually safe to ignore.
          // If it's an abort while we expected to be listening, restart.
          if (
            typeof err === 'string' &&
            (err === 'no-speech' || err === 'aborted')
          ) {
            recognizerRef.current = null;
            if (liveStateRef.current === 'listening') {
              startRecognizer();
            }
          }
        },
      });
      recognizerRef.current.start();
    } catch {
      setTextOnly(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRecognizer = useCallback(() => {
    try {
      recognizerRef.current?.stop();
    } catch {
      /* ignore */
    }
    recognizerRef.current = null;
  }, []);

  /* ---------------- VAD callbacks ---------------- */

  const onVadSpeechStart = useCallback(() => {
    // VAD heard the user — promote listening → recording.
    // The recognizer is already running, so we don't restart it.
    if (liveStateRef.current !== 'listening') return;
    setLiveState('recording');
    audioAnalyzerRef.current?.beginTurn();
  }, []);

  const onVadSpeechEnd = useCallback(() => {
    if (liveStateRef.current !== 'recording') return;
    void submitTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- start recognizer whenever we transition to listening ---------------- */
  useEffect(() => {
    if (liveState === 'listening' && !textOnly) {
      // clear stale transcript at the start of a new turn
      setComposedText('');
      setPartialTranscript('');
      finalTranscriptRef.current = '';
      startRecognizer();
    }
    if (liveState === 'submitting' || liveState === 'ai_speaking' || liveState === 'paused') {
      stopRecognizer();
    }
    // textOnly toggle: stop the recognizer if user switched mid-listening
    if (textOnly) stopRecognizer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveState, textOnly]);

  /* ---------------- submit a turn ---------------- */

  const submitTurn = useCallback(async () => {
    // Stop the recognizer FIRST so it flushes any in-flight final result,
    // then wait a moment so the onFinal callback can update finalTranscriptRef.
    stopRecognizer();
    await new Promise((r) => setTimeout(r, 200));

    const text = (
      finalTranscriptRef.current ||
      composedText ||
      partialTranscript
    ).trim();
    if (!text) {
      // Drop back to listening — VAD probably triggered on a noise
      setLiveState('listening');
      return;
    }

    setLiveState('submitting');

    // Flush per-turn metrics
    const audioMetrics: AudioMetrics | null = audioAnalyzerRef.current
      ? audioAnalyzerRef.current.endTurn(text)
      : null;
    const visualMetrics: VisualMetrics = visionAggRef.current.flush();

    // Optimistically append candidate turn
    setTurns((prev) => [...prev, { speaker: 'candidate', content: text }]);
    setComposedText('');
    setPartialTranscript('');
    finalTranscriptRef.current = '';

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

      // Speak the next interviewer turn, then drop back to listening
      setLiveState('ai_speaking');
      await speak(data.agentTurn.content);
      setLiveState('listening');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLiveState('listening');
    }
  }, [composedText, partialTranscript, sessionId, stopRecognizer]);

  /* ---------------- pause/resume ---------------- */
  const togglePause = useCallback(() => {
    setLiveState((s) => (s === 'paused' ? 'listening' : 'paused'));
  }, []);

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
        /* ignore */
      }
      audioAnalyzerRef.current?.stop();
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

  if (phase === 'ending') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6">
        <div className="glass-strong w-full p-10 text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-300" />
          <h2 className="mt-6 text-xl font-semibold">Generating your report…</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Agent 6 is aggregating every signal from the session.
          </p>
        </div>
      </main>
    );
  }

  /* ----- warmup + live share the same layout, with a small overlay note in warmup ----- */

  const showWarmupBanner = phase === 'warmup';

  return (
    <main className="mx-auto flex h-screen max-w-[1400px] flex-col px-4 py-4 sm:px-6 sm:py-6">
      <TopBar
        targetRole={targetRole}
        agenda={agenda}
        progress={Math.min(turns.length, agenda.length * 2)}
        timeRemaining={timeRemaining}
        onEnd={endInterview}
      />

      <div className="mt-4 grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* LEFT: AI interviewer + transcript */}
        <InterviewerPane
          turn={latestAgentTurn}
          liveState={liveState}
          composedText={composedText}
          partialTranscript={partialTranscript}
          textOnly={textOnly}
          setTextOnly={setTextOnly}
          setComposedText={setComposedText}
          onSubmit={submitTurn}
          onTogglePause={togglePause}
        />

        {/* RIGHT: webcam + live gauges */}
        <CandidateCam
          videoRef={videoRef}
          overlayRef={overlayRef}
          gauges={gauges}
          micLevel={micLevel}
          liveState={liveState}
          warmup={showWarmupBanner}
        />
      </div>

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
          We'll need access to your <strong className="text-foreground">camera</strong>{' '}
          and <strong className="text-foreground">microphone</strong>. Your video is
          processed entirely on your device — only summary scores are sent to our server.
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
            Hands-free: just speak naturally and we'll auto-detect your turn.
            Best in Chrome / Edge.
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

function CompletedView({ sessionId }: { sessionId: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6">
      <div className="glass-strong w-full max-w-md p-10 text-center">
        <h2 className="text-xl font-semibold">This interview is complete.</h2>
        <p className="mt-2 text-sm text-muted-foreground">View the report below.</p>
        <a
          href={`/interview/${sessionId}/report`}
          className="mt-6 inline-block rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white"
        >
          Open report
        </a>
      </div>
    </main>
  );
}

/* ----- Top bar ----- */

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
  const totalSlots = agenda.length * 2;
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

/* ----- Interviewer pane (LEFT) ----- */

function InterviewerPane({
  turn,
  liveState,
  composedText,
  partialTranscript,
  textOnly,
  setTextOnly,
  setComposedText,
  onSubmit,
  onTogglePause,
}: {
  turn: DisplayedTurn | null;
  liveState: LiveState;
  composedText: string;
  partialTranscript: string;
  textOnly: boolean;
  setTextOnly: (b: boolean) => void;
  setComposedText: (s: string) => void;
  onSubmit: () => void;
  onTogglePause: () => void;
}) {
  return (
    <section className="glass-strong relative flex flex-col p-6 sm:p-8">
      {/* Avatar + meta */}
      <div className="flex items-center gap-4">
        <div className="relative flex h-14 w-14 items-center justify-center">
          <div
            className={
              'absolute inset-0 rounded-full bg-gradient-to-br from-brand-400 to-brand-700 ' +
              (liveState === 'ai_speaking' ? 'animate-pulse' : '')
            }
          />
          <Sparkles className="relative h-6 w-6 text-white" />
        </div>
        <div className="flex-1">
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
        <StatusPill state={liveState} />
      </div>

      {/* Question */}
      <div className="mt-8 flex-1">
        <p className="text-balance text-xl leading-relaxed text-foreground/95 sm:text-2xl">
          {turn?.content ?? 'Preparing your first question…'}
        </p>
      </div>

      {/* Live transcript */}
      <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
          <span>Your answer (live)</span>
          <button
            onClick={() => setTextOnly(!textOnly)}
            className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-1 text-xs text-foreground/80 transition hover:bg-white/[0.08]"
          >
            {textOnly ? <Mic className="h-3 w-3" /> : <Type className="h-3 w-3" />}
            {textOnly ? 'Voice mode' : 'Type instead'}
          </button>
        </div>

        {textOnly ? (
          <textarea
            value={composedText}
            onChange={(e) => setComposedText(e.target.value)}
            placeholder="Type your answer here…"
            rows={4}
            className="mt-2 min-h-[100px] w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-brand-400/50 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
          />
        ) : (
          <div className="mt-2 min-h-[80px] text-sm leading-relaxed text-foreground/85">
            {composedText}
            {partialTranscript && (
              <span className="text-muted-foreground italic"> {partialTranscript}</span>
            )}
            {!composedText && !partialTranscript && (
              <span className="text-muted-foreground/60 italic">
                {liveState === 'listening'
                  ? 'Speak whenever you\'re ready — we\'ll auto-submit when you pause.'
                  : liveState === 'recording'
                  ? 'Listening…'
                  : liveState === 'submitting'
                  ? 'Sending your answer…'
                  : liveState === 'ai_speaking'
                  ? 'Interviewer is speaking…'
                  : 'Paused.'}
              </span>
            )}
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onTogglePause}
            disabled={liveState === 'submitting' || liveState === 'ai_speaking'}
            className="gap-1.5"
          >
            {liveState === 'paused' ? (
              <>
                <Play className="h-3.5 w-3.5" /> Resume
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5" /> Pause
              </>
            )}
          </Button>
          {/* Send button: always available in text mode; available in voice mode
              as a manual escape hatch when VAD is being slow. */}
          {(textOnly || liveState === 'recording' || liveState === 'listening') && (
            <Button
              size="sm"
              onClick={onSubmit}
              disabled={
                liveState === 'submitting' ||
                (textOnly
                  ? !composedText
                  : !composedText && !partialTranscript)
              }
              className="ml-auto gap-1.5"
            >
              {liveState === 'submitting' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" /> Send now
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function StatusPill({ state }: { state: LiveState }) {
  const cfg: Record<
    LiveState,
    { label: string; color: string; pulse?: boolean }
  > = {
    ai_speaking: { label: 'Speaking', color: 'text-brand-300 border-brand-400/30 bg-brand-500/10' },
    listening: {
      label: 'Listening',
      color: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
      pulse: true,
    },
    recording: {
      label: 'Recording',
      color: 'text-red-300 border-red-400/30 bg-red-500/10',
      pulse: true,
    },
    submitting: { label: 'Thinking', color: 'text-amber-300 border-amber-400/30 bg-amber-500/10' },
    paused: { label: 'Paused', color: 'text-muted-foreground border-white/10 bg-white/[0.04]' },
  };
  const c = cfg[state];
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ' +
        c.color
      }
    >
      <span
        className={
          'h-1.5 w-1.5 rounded-full bg-current ' + (c.pulse ? 'animate-pulse' : '')
        }
      />
      {c.label}
    </span>
  );
}

/* ----- Candidate cam (RIGHT) ----- */

function CandidateCam({
  videoRef,
  overlayRef,
  gauges,
  micLevel,
  liveState,
  warmup,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  gauges: { eyeContact: number; engagement: number; posture: number };
  micLevel: number;
  liveState: LiveState;
  warmup: boolean;
}) {
  return (
    <section className="glass relative flex flex-col p-4 sm:p-5">
      {/* Webcam — large, mirrored, with face-mesh canvas overlay */}
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/40">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-[400px] w-full -scale-x-100 object-cover sm:h-[440px]"
        />
        <canvas
          ref={overlayRef}
          className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100"
        />

        {/* Top-right privacy badge */}
        <div className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] uppercase tracking-wider text-emerald-300 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Local only · {Math.round(gauges.engagement * 100)}% engaged
        </div>

        {/* Top-left status */}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
          <StatusPill state={liveState} />
        </div>

        {/* Bottom mic waveform */}
        <div className="pointer-events-none absolute bottom-3 left-3 right-3">
          <MicWaveform level={micLevel} active={liveState === 'recording' || liveState === 'listening'} />
        </div>

        {warmup && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="rounded-xl border border-white/10 bg-background/80 px-5 py-3 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-300" />
              <div className="mt-2 text-xs text-foreground/85">
                Calibrating vision baseline…
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Live metric gauges */}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Gauge label="Eye contact" value={gauges.eyeContact} accent="brand" />
        <Gauge label="Engagement" value={gauges.engagement} accent="emerald" />
        <Gauge label="Posture" value={gauges.posture} accent="violet" />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Vision metrics update in real time. Raw video and audio never leave your
        browser — only the per-turn summary scores reach the server.
      </p>
    </section>
  );
}

function Gauge({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: 'brand' | 'emerald' | 'violet';
}) {
  const colorClass =
    accent === 'brand'
      ? 'from-brand-500 to-brand-300'
      : accent === 'emerald'
      ? 'from-emerald-500 to-emerald-300'
      : 'from-violet-500 to-violet-300';
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-foreground">{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${colorClass} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MicWaveform({ level, active }: { level: number; active: boolean }) {
  // 16 bars; the `level` (RMS, ~0..0.3 typical) drives heights with subtle randomization
  const bars = 16;
  const lvl = Math.max(0, Math.min(1, level * 6));
  return (
    <div className="flex h-7 items-end justify-center gap-[2px] rounded-md bg-black/40 px-2 py-1 backdrop-blur-sm">
      {Array.from({ length: bars }).map((_, i) => {
        // Center bars are most active
        const middleness = 1 - Math.abs(i - bars / 2) / (bars / 2);
        const h = active ? Math.max(0.08, lvl * (0.4 + 0.6 * middleness)) : 0.08;
        return (
          <span
            key={i}
            className={
              'w-[3px] rounded-full transition-[height] duration-75 ' +
              (active ? 'bg-emerald-400/80' : 'bg-white/20')
            }
            style={{ height: `${Math.round(h * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

/* ============================================================ helpers */

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

/**
 * Draw the 478 face landmarks as small dots on the overlay canvas.
 * Cheap (a few hundred 2-pixel circles per frame).
 */
function drawFaceMesh(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  result: FaceLandmarkerResult
): void {
  if (!canvas || !video) return;

  // Match canvas pixel dims to displayed video dims for crisp 1:1 dots
  const w = video.clientWidth;
  const h = video.clientHeight;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  const lm = result.faceLandmarks?.[0];
  if (!lm || lm.length === 0) return;

  ctx.fillStyle = 'rgba(91, 103, 255, 0.55)'; // brand-500 with alpha
  for (const p of lm) {
    const x = p.x * w;
    const y = p.y * h;
    ctx.beginPath();
    ctx.arc(x, y, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
}
