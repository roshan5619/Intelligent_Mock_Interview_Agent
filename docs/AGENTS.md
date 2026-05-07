# Agents reference

One section per agent. Every agent is decoupled — a pure module with a typed
input and a typed output. The system prompts live as `.md` files in
`lib/prompts/` and are diff-friendly.

---

## Agent 1 — Context Understanding Module

**File:** [`lib/agents/context-understanding.ts`](../lib/agents/context-understanding.ts)
**Prompt:** [`lib/prompts/01_context_understanding.md`](../lib/prompts/01_context_understanding.md)
**Provider:** Gemini 2.0 Flash (native PDF reading) — falls back to Groq over extracted text

**Input:** `Buffer` (PDF) **or** `string` (already-extracted text)

**Output:** `ContextProfile`
```ts
{
  skills: string[];
  years_total: number;
  roles: { title, org?, years? }[];
  projects: { name, summary, impact?, tech? }[];
  education: { degree, school?, year? }[];
  certs: string[];
  domains: string[];
  seniority_signals: string[];
  inferred_roles: { role, confidence, rationale, matched_evidence[] }[];
}
```

**Failure modes:** zod validation throws `ContextParseError` with the raw LLM output for debugging.

---

## Agent 2 — Interview Orchestrator

**File:** [`lib/agents/orchestrator.ts`](../lib/agents/orchestrator.ts)
**Prompt:** [`lib/prompts/02_orchestrator.md`](../lib/prompts/02_orchestrator.md)
**Provider:** Groq Llama 3.3 70B (fast — ~1-2s per decision)

**Input:** `OrchestratorInput` — job, profile, agenda, recent turns, latest metrics, confidence + correctness trends, time budget.

**Output:** `OrchestratorDecision`
```ts
{
  intent: 'probe_deeper' | 'switch_topic' | 'drop_difficulty' |
          'ramp_difficulty' | 'clarify' | 'encourage' | 'wrap_up';
  target_focus_area: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  question_style: 'open_ended' | 'scenario' | 'system_design' |
                  'behavioral_star' | 'trivia';
  next_question: string; // ≤ ~50 words
}
```

**Hard heuristics applied AFTER the LLM:**
- 2 consecutive turns with `confidence < 0.4` → force `drop_difficulty` + prepend warm encouragement
- 2 consecutive turns with `correctness > 0.85` → force `ramp_difficulty`
- `time_budget < 2 min` → force `wrap_up`

---

## Agent 3 — Audio Intelligence

**Browser file:** [`lib/voice/audio-analyzer.ts`](../lib/voice/audio-analyzer.ts)
**Server file:** [`lib/agents/audio-intelligence.ts`](../lib/agents/audio-intelligence.ts)
**Prompt:** [`lib/prompts/03_audio_intelligence.md`](../lib/prompts/03_audio_intelligence.md)

### Browser side
Per-turn collector. Samples Web Audio at 50ms windows.

**Output (per turn):** `AudioMetrics`
```ts
{
  wpm, fillers_per_min, pause_ratio,
  pitch_mean_hz, pitch_variance,
  rms_mean, rms_variance, silence_pct
}
```

### Server side
Takes the transcript + the metrics blob and asks Groq to score:

**Output:** `AudioScore`
```ts
{
  confidence: 0..1,
  clarity: 0..1,
  evidence: string,        // 1 sentence — must be a real quote/signal
  signals_summary: string  // 1 sentence interpretation
}
```

---

## Agent 4 — Visual Intelligence

**Browser files:**
- [`lib/vision/mediapipe-loader.ts`](../lib/vision/mediapipe-loader.ts) — lazy-loads `FaceLandmarker` + `PoseLandmarker`
- [`lib/vision/metrics-aggregator.ts`](../lib/vision/metrics-aggregator.ts) — per-frame observer + per-turn rollup

**Server file:** [`lib/agents/visual-intelligence.ts`](../lib/agents/visual-intelligence.ts) — **NO LLM**. Pure deterministic math (per spec preference for pretrained CV).

**Per-frame inputs (browser):** MediaPipe results (478 face landmarks, 33 pose landmarks, 52 facial blendshapes).

**Per-turn output:** `VisualMetrics`
```ts
{
  eye_contact_ratio,
  head_pose_stability,
  posture_score,
  smile_intensity_mean, brow_raise_mean, jaw_tension_mean,
  blink_rate_per_min,
  frames_analyzed,
}
```

**Server formulas:**
```
engagement = 0.5
           + 0.25 * (eye_contact_ratio - 0.5)
           + 0.15 * (smile + brow_raise)
           + 0.10 * (head_pose_stability - 0.5)

stress     = 0.5 * jaw_tension
           + 0.3 * (1 - eye_contact_ratio)
           + 0.2 * (1 - head_pose_stability)
```

---

## Agent 5 — Technical Evaluation Engine

**File:** [`lib/agents/technical-evaluation.ts`](../lib/agents/technical-evaluation.ts)
**Prompt:** [`lib/prompts/05_technical_evaluation.md`](../lib/prompts/05_technical_evaluation.md)
**Provider:** Groq Llama 3.3 70B

**Input:** question + focus area + expected concepts + abbreviated profile + candidate answer.

**Output:** `TechnicalScore`
```ts
{
  correctness: 0..1,
  depth: 0..1,
  specificity: 0..1,
  concept_coverage: 0..1,
  evidence_quote: string,   // MUST be a substring of the answer
  flags: string[]           // 'hallucination' | 'contradiction_with_resume' |
                            // 'off_topic' | 'insufficient_detail'
}
```

**Calibration note:** the prompt instructs the LLM that most senior-engineer answers fall in 0.5-0.8; reserve 0.9+ for genuinely outstanding answers.

---

## Agent 6 — Feedback & Coaching

**File:** [`lib/agents/feedback-coaching.ts`](../lib/agents/feedback-coaching.ts)
**Prompt:** [`lib/prompts/06_feedback_coaching.md`](../lib/prompts/06_feedback_coaching.md)
**Provider:** Groq Llama 3.3 70B
**Runs:** ONCE at end of session.

**Input:** sessionId, job, profile, full transcript, all per-turn `AgentEvaluation` rows.

**Output:** `Report`
```ts
{
  summaryMd: string,            // 2 sentences
  scores: {
    technical, communication, confidence, engagement, overall // all 0-100
  },
  strengthsMd: string,           // markdown list with quoted evidence
  improvementsMd: string,        // markdown list with SPECIFIC actionable steps
  behavioralInsightsMd: string,  // 1-2 paras interpreting audio + visual together
  nextStepsMd: string,           // markdown list of 3-5 concrete actions this week
}
```

**Server post-processing:** `overall` is **recomputed** server-side using the documented weights (0.35/0.30/0.20/0.15) so the LLM can't drift.

---

## Decoupling guarantees

- **Each agent is one TS file**, with one entry-point function, callable in isolation.
- **System prompts are `.md` files** in `lib/prompts/`, loaded by `lib/prompts/index.ts` once and cached.
- **All LLM calls** go through `lib/llm/client.ts` — swapping providers is a single env-var change.
- **All DB calls** go through `lib/storage/db.ts` — Postgres migration is SQL-portable.
- **Browser ML** is independent of server agents; the contract is the `AudioMetrics` / `VisualMetrics` JSON shape only.
- **Tests can swap any agent or adapter for a fake** without touching pages/routes.
