# IPHIPI — Gamma AI Presentation Script

> **How to use this file**
> 1. Go to **https://gamma.app** → New → **Generate**
> 2. Choose **"Paste in text"** → paste everything below the `--- START SCRIPT ---` line
> 3. Pick a theme (recommend a dark + tech theme: *Bold*, *Vivid Dark*, or *Nightfall*)
> 4. Set length to **"Detailed"** for ~22 slides, or **"Standard"** for ~15
> 5. Generate → tweak slide-by-slide as needed
>
> Each slide is separated by `---`. Lines starting with `# `, `## `, etc. are headings. Lines in brackets like `[image: ...]` are prompts Gamma will use to generate visuals.

--- START SCRIPT ---

# IPHIPI — Agentic AI Mock Interview Platform

Six agents. One natural conversation.

**Multimodal · adaptive · explainable — on free SOTA models.**

- Live demo: iphpi-hackthon.vercel.app
- Repository: github.com/roshan5619/Intelligent_Mock_Interview_Agent
- Stack: Next.js · Groq Llama 3.3 70B · Gemini 2.0 · MediaPipe

[image: a futuristic AI interview interface with a candidate's webcam on one side and a glowing AI avatar on the other, dark navy and electric blue gradient, modern UI design]

---

# The problem we set out to solve

Senior professionals (10–15+ years) cannot find rigorous, role-appropriate interview practice.

**Three pain points:**

- **Static** — Question banks don't adapt to the candidate's resume, seniority, or live performance.
- **Text-only** — Generic LLM chats can't read body language or vocal cues, signals that matter for senior roles.
- **Opaque** — Most tools surface a score with no evidence and no path to improvement.

IPHIPI closes the gap.

[image: three pillar icons in glowing blue showing a chat bubble crossed out, a microphone with a question mark, and a black box, on a dark gradient background]

---

# What we built

An **agentic** platform that:

- **Reads** the candidate's resume and infers the roles they can realistically land
- **Conducts** a live multimodal interview (video + audio), dynamically generating questions and adapting difficulty
- **Coaches** with per-dimension scores, evidence quotes, and concrete next steps

Hands-free — voice activity detection drives the conversation. No mic button to press.

**By the numbers:** 6 specialized agents · 4 score dimensions · $0 infrastructure cost (free tiers)

[image: a clean dashboard showing a candidate's interview report with score rings, transcript snippets, and coaching insights, dark theme with brand-blue accents]

---

# End-to-end user journey

A 7-step flow from resume to coaching report:

1. **Upload** resume (PDF)
2. **Agent 1** parses it into a structured context profile
3. **JD-match** ranks every IPHIPI role with explainable sub-scores
4. **Apply** to a role → see the animated fit ring
5. **Mock interview** — hands-free, multimodal, ~10 minutes
6. **Live scoring** in parallel across audio, visual, and technical dimensions
7. **Coaching report** with per-dimension scores, evidence quotes, and 5 next steps

[image: horizontal flow diagram with 7 connected card-style steps, each with an icon, glowing brand-blue arrows between them, dark navy background]

---

# High-level architecture

A three-tier topology:

**Browser** — does ALL multimodal capture + ML:
- MediaStream (webcam + mic)
- Web Audio API (VAD, RMS, pitch)
- Web Speech API (STT + TTS)
- MediaPipe Tasks (face + pose landmarks)

**Vercel functions** (Node runtime):
- Next.js pages and API routes
- Six agent modules
- Multi-provider LLM router

**Managed services** (all free tiers):
- Turso (libSQL DB)
- Vercel Blob (private resume storage)
- Groq Cloud (Llama 3.3 70B)
- Google Gemini 2.0 Flash (PDF + embeddings)

Raw video and audio never leave the browser — only ~2 KB of metric JSON per turn.

[image: three-layer architecture diagram with browser at top, server in middle, external services at bottom, connected with data-flow arrows, clean minimal style on dark background]

---

# The six agents

| # | Agent | Runs in | Tech |
|---|---|---|---|
| 1 | Context Understanding | Server | Gemini 2.0 Flash (native PDF) + Groq fallback |
| 2 | Interview Orchestrator | Server | Groq Llama 3.3 70B + adaptive heuristics |
| 3 | Audio Intelligence | Browser + Server | Web Audio capture; Groq scoring |
| 4 | Visual Intelligence | Browser only | MediaPipe (pretrained CV, no LLM) |
| 5 | Technical Evaluation | Server | Groq Llama 3.3 70B + rubric |
| 6 | Feedback & Coaching | Server | Groq Llama 3.3 70B aggregating per-turn signals |

**Decoupling guarantees:**
- One agent, one file
- Prompts are data (markdown files), not code
- Storage interfaces are swappable

[image: a hexagonal cluster diagram with six labeled agent nodes around a central "candidate" node, glowing connections, futuristic AI dashboard style]

---

# Agent 1 — Context Understanding

**What it does:** Reads the resume and produces a structured `ContextProfile`.

**Pipeline:**
1. Gemini 2.0 Flash reads the PDF **natively** — no pdf-parse step on the happy path
2. LLM emits structured JSON (skills, years, roles, projects, seniority signals, inferred roles)
3. `zod` validates the shape; throws `ContextParseError` on drift
4. Fallback: pdf-parse → Groq when Gemini is rate-limited

**Hard rule:** Never invent skills the candidate doesn't claim.

```json
{
  "skills": ["Java", "Kafka", "AWS", "..."],
  "years_total": 15,
  "inferred_roles": [{
    "role": "Backend",
    "confidence": 0.88,
    "rationale": "...",
    "matched_evidence": [...]
  }]
}
```

[image: stylized icon of a PDF document being parsed into structured JSON data with code-bracket symbols, dark theme]

---

# Agent 2 — Interview Orchestrator

**The conversational driver.** Decides every next interviewer turn from the profile, agenda, transcript, multimodal metrics, and time budget.

**LLM output:**
- `intent`: probe_deeper | drop_difficulty | ramp_difficulty | clarify | encourage | wrap_up
- `target_focus_area`, `difficulty` (1–5), `question_style`
- `next_question` (≤ 50 words)

**Adaptive difficulty as code (not prompt):**
- 2 consecutive turns with confidence < 0.4 → force **drop_difficulty** + prepend warm encouragement
- 2 consecutive turns with correctness > 0.85 → force **ramp_difficulty**
- Time budget < 2 minutes → force **wrap_up**

The LLM still writes the sentence. The policy is code.

[image: decision-tree flow diagram showing the orchestrator branching on metrics, with brand-color highlighted decision paths]

---

# Agent 3 — Audio Intelligence

**Hears confidence and clarity** from voice + transcript.

**Browser-side signals (50 ms samples):**
- RMS mean + variance (volume envelope)
- Pitch F0 + variance via autocorrelation
- Pause ratio, silence percentage
- Words per minute from transcript
- Filler rate (um / uh / like / you know)

**Voice activity detection:**
- Start: RMS > 0.030 for ≥ 200 ms
- End: RMS < 0.030 for ≥ 900 ms → auto-submit

**Server scoring (Groq):**
- Confidence HIGH (>0.7) when WPM ∈ [110, 160], fillers < 2/min, healthy pitch variance, silence < 0.2
- Confidence LOW (<0.4) when WPM erratic OR fillers > 6/min OR pitch flat OR silence > 0.4

[image: audio waveform visualization with annotations showing pitch, pauses, and filler-word detection, neon blue on dark]

---

# Agent 4 — Visual Intelligence

**Sees engagement and stress** without sending video off-device.

**Browser (MediaPipe Tasks, WASM):**
- FaceLandmarker — 478 points + 52 blendshapes
- PoseLandmarker — 33 keypoints
- Runs at ~15 FPS, on-device
- Live face-mesh dots overlay the webcam — visible proof the model is running

**Deterministic server scoring** (per the brief: prefer pretrained CV over LLMs):

`engagement = 0.5 + 0.25 × (eye_contact - 0.5) + 0.15 × (smile + brow_raise) + 0.10 × (head_pose_stability - 0.5)`

`stress = 0.5 × jaw_tension + 0.3 × (1 - eye_contact) + 0.2 × (1 - head_pose_stability)`

No model call. Cheap, deterministic, always available.

[image: a face with 478 tiny tracking dots overlaid in glowing blue, plus pose-tracking skeleton outline on shoulders, futuristic AI vision interface]

---

# Agent 5 — Technical Evaluation

**Grades each answer** against the question that triggered it.

**Four dimensions (0–1):**
- `correctness` — technical accuracy of claims
- `depth` — tradeoffs, edge cases, alternatives
- `specificity` — numbers, named systems, observed outcomes
- `concept_coverage` — expected concepts touched / total

**Plus mandatory:**
- `evidence_quote` — must be a substring of the candidate's answer
- `flags` — hallucination | contradiction_with_resume | off_topic | insufficient_detail

**Calibration anchor:** Most senior answers fall in 0.5–0.8. Reserve 0.9+ for genuinely outstanding answers.

A candidate can be **correct but shallow** or **wide but inaccurate** — splitting the score surfaces each failure mode.

[image: a graph showing four bar charts labeled correctness/depth/specificity/coverage with a thoughtful-AI brain icon, clean infographic style]

---

# Agent 6 — Feedback & Coaching

**Runs once at end of session.** Aggregates every per-turn signal + the full transcript into a structured report.

**Output sections:**
- Headline summary (2 sentences)
- Per-dimension scores (technical, communication, confidence, engagement) — 0 to 100
- Strengths (markdown bullets with **evidence quotes**)
- Improvements (markdown bullets with **specific, actionable** steps)
- Behavioural insights (1–2 paragraphs interpreting audio + visual signals together)
- Next steps (3–5 concrete actions this week)

**Final overall score:**

`overall = 0.35 × technical + 0.30 × communication + 0.20 × confidence + 0.15 × engagement`

The overall is **recomputed server-side** after the LLM returns, so the model can't drift on the weighting.

[image: a polished coaching report on a dark dashboard with score rings, strength/improvement bullets, and quoted transcript snippets]

---

# What happens in one interview turn

A six-agent pipeline in ~2-3 seconds end-to-end:

1. Browser flushes audio + visual metrics
2. POST `/api/interview/turn`
3. Persist candidate turn
4. **In parallel:** Agent 3 (audio LLM), Agent 4 (CV math), Agent 5 (tech LLM)
5. Persist all per-dimension evaluations
6. Build 2-turn confidence + correctness trends
7. Agent 2 (Orchestrator) decides next turn; heuristics may override
8. Return JSON → TTS speaks → loop

**Latency math:**

`T_turn ≈ max(T3, T4, T5) + T2 ≈ 1–1.5s parallel + 1–1.5s orchestrator ≈ 2–3s total`

Sequential execution would be ~5–6s. Parallel is the difference between conversational and awkward.

[image: a swim-lane sequence diagram with the candidate, browser, server, and three parallel agent lanes, color-coded arrows showing parallel execution]

---

# Scoring — JD match

**Hybrid score in [0, 100]:**

`score(P, J) = (0.4 × s_emb + 0.4 × s_skill + 0.2 × s_senior) × 100`

**Three components:**

**Semantic** — Cosine similarity of Gemini 768-dim embeddings of profile-text and JD-text.

**Skill overlap** — Weighted by must-have (1.0) vs nice-to-have (0.4). Each requirement matches if any content word appears in the profile's token bag.

**Seniority fit** — Step function: 1.0 if years in [min, max], 0.7 slightly out, 0.4 further out, 0.1 otherwise.

**Rationale** — After the deterministic numeric score, the LLM writes a 2–3 sentence "why this fits" rationale grounded in the matched/gap lists. **Never overrides** the number.

[image: a circular score ring at 87% next to three smaller component bars showing semantic, skill, and seniority sub-scores, modern data-viz style]

---

# The tech stack and why each piece

- **Next.js 15 + Vercel** — one repo, one deploy, one CDN. Server actions co-located with pages.
- **Groq Llama 3.3 70B** — ~500 tok/s, near-frontier reasoning, free 30 RPM / 14,400 RPD. Orchestrator first-token: ~300 ms.
- **Google Gemini 2.0 Flash** — native PDF understanding (no pdf-parse). Embeddings via `gemini-embedding-001`.
- **MediaPipe Tasks** — pretrained CV in WASM, free, on-device, 15-30 FPS.
- **Web Speech API + Web Audio API** — browser-native voice, zero infra, zero cost.
- **Turso (libSQL)** — SQLite-compatible managed DB; same DAL works in Postgres v2.
- **Vercel Blob (private)** — 1 GB free; signed download URLs via head() token.
- **HMAC-signed cookie** — no signup friction; magic-link in v2.

**Multi-provider LLM router:** auto-fallback Groq → Gemini → Ollama on rate-limit or outage. The demo never hard-fails.

[image: a stack diagram with each tech logo (Next.js, Groq, Gemini, MediaPipe, Turso, Vercel) arranged in layers, glowing connections, dark modern infographic]

---

# Key design decisions

**1. Browser does all multimodal capture + ML**
Privacy provable from the network tab. No GPU functions required. ~2 KB payload, not megabytes of video.

**2. Single base model, six system prompts**
One latency profile, one cost profile, one failure mode. We tune temperature per agent, not the model.

**3. Async non-blocking evaluators**
Agents 3, 4, 5 run in parallel via `Promise.all`. Cuts perceived latency from ~6s to ~2.5s.

**4. Adaptive difficulty as code**
Hard heuristics override the LLM on confidence dips, correctness streaks, or time pressure. Reliable, not hopeful.

**5. Pretrained CV over LLMs for body language**
MediaPipe gives exact landmark coordinates at 15 FPS. A vision LLM would be 1000× slower and non-deterministic.

**6. Every score ships with evidence**
"You scored 71" becomes "You scored 71 because in turn 4 you led with the technology stack rather than the constraint it solved."

[image: six numbered cards arranged in a 2x3 grid, each with a short icon and decision title, dark modern infographic with brand-blue accents]

---

# The interview feels like a conversation

**Hands-free state machine:**

`AI speaking → Listening → Recording → Thinking → AI speaking → ...`

Transitions driven by voice activity detection:
- Listening → Recording when RMS > 0.030 for ≥ 200 ms
- Recording → Thinking when RMS < 0.030 for ≥ 900 ms (auto-submit)
- Thinking → AI speaking when server returns + TTS plays

**Visible proof the agents are working:**
- Live face-mesh overlay on webcam (478 dots) — candidate sees vision model tracking their face
- Live audio waveform bar across the bottom of the cam
- Eye-contact, engagement, posture gauges update every 250 ms

No mic button. No Send button. Just speak naturally.

[image: a four-state circular diagram showing AI Speaking → Listening → Recording → Thinking states, with smooth glowing arrows, futuristic UI style]

---

# Privacy and security

**What never leaves the browser:**
- Raw video frames
- Raw audio buffers
- Microphone PCM data

Only the per-turn aggregated metric JSONs (~2 KB each) reach the server. A "Local only" badge in the cam corner reinforces this.

**Resume protection:** Vercel Blob with `access: 'private'`. The blob URL is internal-only; the server reads bytes back via `head()` with a token that signs the download URL.

**Cookie identity (prototype):**

`cookie = b64url(payload) . b64url(HMAC_K(payload))`

Verification uses `timingSafeEqual`. Forgery requires `HMAC_SECRET`.

**Ownership checks:** Every protected route asserts the cookie's candidate ID matches the application/session being acted on.

[image: a padlock icon merged with a webcam silhouette, surrounded by a glowing dome, indicating browser-side privacy, security-focused dark visualization]

---

# Limitations we ship with

- **Browser support.** Web Speech + MediaPipe both need a Chromium-based browser. Firefox lacks SpeechRecognition. "Type instead" toggle is the universal fallback.
- **Concurrency.** Groq free tier is 30 RPM. Sustained concurrent interviews would saturate it; production needs a paid tier or a queue.
- **Resume formats.** PDF only. .docx and .txt deferred to v2.
- **Single language.** Prompts + STT default to English. Multilingual is a swap-in.
- **No real-time interruption.** Candidate must finish their turn before the next interviewer turn fires. Full duplex would need WebRTC.
- **Eye contact from head pose, not iris gaze.** Sufficient for "is the candidate facing the camera" but can't distinguish looking-at-notes from looking-at-AI.
- **VAD sensitivity.** A noisy environment may false-trigger. User can switch to text mode at any time.

Honest, not performative.

[image: a clean checklist visualization with seven items, each with an icon, in a single column on a dark slide]

---

# Next steps — v2 roadmap

**Near-term:**
- Supabase magic-link auth + returning-candidate dashboard with interview history
- Deepgram (STT) + ElevenLabs (TTS) for broadcast-quality cross-browser voice
- Anthropic Claude Sonnet as a third LLM provider, routed for the report
- Mobile-friendly interview workspace

**Production-readiness:**
- Eval harness with golden interviews + LLM-as-judge regression tests on every prompt change
- Agent-decision audit log for compliance
- Upstash Redis token-bucket rate limiting per user + per IP
- ATS push (Greenhouse / Lever / Workday)
- GDPR consent at upload, 30-day retention with auto-deletion, opt-out path, DPA for enterprise
- Real-time interruption over WebRTC

[image: a roadmap timeline divided into "near-term" and "production-readiness" branches with milestone markers, futuristic timeline visualization]

---

# Live demo

**iphpi-hackthon.vercel.app**

Chrome or Edge · Webcam + mic on

**Five-step flow:**

1. Upload a PDF resume on `/match-me`
2. Wait ~25s for Agent 1 + JD-match across all 6 roles
3. Pick top-ranked role → apply → start interview
4. Grant camera + mic → answer 3–4 turns hands-free
5. End → get the per-dimension report with evidence quotes

[image: a giant URL card on a dark slide with a play-button icon, clean and bold call-to-action style]

---

# Thank you

**Questions?**

- Live demo: iphpi-hackthon.vercel.app
- Repository: github.com/roshan5619/Intelligent_Mock_Interview_Agent
- Architecture document: docs/ARCHITECTURE.tex
- Q&A walkthrough: docs/INTERVIEW_QA.html

[image: a clean closing slide with the IPHIPI wordmark in glowing brand-blue against a dark gradient background]

--- END SCRIPT ---

## Tips for tweaking in Gamma after generation

- **If a slide is too text-heavy:** ask Gamma to "Simplify" via the side menu.
- **For the architecture and per-turn flow slides:** Gamma's auto-diagrams are weaker than the TikZ ones in the .tex deck — consider screenshotting the .pdf versions and pasting them in.
- **Theme:** *Vivid Dark* or *Nightfall* match the IPHIPI brand best.
- **Aspect ratio:** Choose 16:9 for projector presentations.
- **Speaker notes:** Add via the "+" menu on each slide → "Speaker notes". Gamma supports markdown there too.

## Estimated talk time

- ~22 slides × 45–60s each = **15–22 minute talk** with Q&A
- For a 10-min lightning version: skip the agent-deep-dive slides (7–12) and jump straight from "Six agents overview" to "Per-turn flow"
