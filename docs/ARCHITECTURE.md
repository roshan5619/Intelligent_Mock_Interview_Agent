# IPHIPI — Architecture

## 1. Problem & user journey

Senior professionals lack rigorous, role-appropriate interview practice. Static question banks don't adapt; generic chat bots don't read body language or vocal cues; scoring is opaque. We built an **agentic AI platform** that reads a resume, infers realistic target roles, runs a live multimodal interview (video + audio), and produces explainable, actionable feedback.

```
land on IPHIPI → upload resume → see fit scores across all roles
                                              │
                                              ▼
                                  pick a role → start interview
                                              │
                                              ▼
              [live multimodal: webcam + mic + transcript composer]
                                              │
              6 agents work in concert (1 LLM + 1 CV + 1 audio + 3 LLM)
                                              │
                                              ▼
               structured report: per-dimension scores + actionable coaching
```

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ BROWSER (Chrome/Edge) — handles ALL multimodal capture + ML     │
│  • MediaStream API (webcam + mic)                               │
│  • Web Audio API → AudioMetrics (RMS, pitch, pauses, fillers)   │
│  • Web Speech API → live transcript + TTS playback              │
│  • MediaPipe Tasks (WASM, pretrained, free):                    │
│      FaceLandmarker, FaceBlendshapes, PoseLandmarker            │
│        → eye contact, posture, expression, head pose, blinks    │
│  Per-turn: ships only ~2KB of metric JSON to the server.        │
│  Raw video and raw audio NEVER leave the browser.               │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ HTTPS (JSON)
┌──────────────────────────────────▼──────────────────────────────┐
│ VERCEL — Next.js 15 server (Node runtime)                       │
│  Pages: marketing, careers, /apply, /candidate, /match-me,      │
│         /interview/[id], /interview/[id]/report                 │
│  API:   /api/apply, /api/match/rank-all,                        │
│         /api/interview/{start,turn,end}                         │
│                                                                 │
│  Every server agent calls lib/llm/client.ts → multi-provider    │
│  router with auto-fallback Groq → Gemini → Ollama.              │
└────┬─────────────────┬──────────────────────────┬───────────────┘
     │                 │                          │
┌────▼──────┐ ┌────────▼─────────┐ ┌──────────────▼──────────────┐
│ Turso     │ │ Vercel Blob      │ │ Groq Cloud  •  Gemini API   │
│ (libSQL)  │ │ (resumes, etc.)  │ │ Llama 3.3 70B • Gemini 2.0  │
│ All app   │ │ Falls back to    │ │ Both free tiers. The router │
│ data      │ │ local FS for dev │ │ falls back transparently.   │
└───────────┘ └──────────────────┘ └─────────────────────────────┘
```

### Module / agent table

| # | Agent | Where it runs | Tech | Output |
|---|---|---|---|---|
| 1 | Context Understanding | Server | Gemini 2.0 Flash (native PDF) | `ContextProfile` JSON |
| 2 | Orchestrator | Server | Groq Llama 3.3 70B + heuristics | `OrchestratorDecision` per turn |
| 3 | Audio Intelligence | Browser + Server | Web Audio API + Groq scoring | `confidence`, `clarity` |
| 4 | Visual Intelligence | Browser only | MediaPipe (pretrained, no LLM) | `engagement`, `stress`, `eye_contact`, `posture` |
| 5 | Technical Evaluation | Server | Groq Llama 3.3 70B | `correctness`, `depth`, `specificity`, `concept_coverage` |
| 6 | Feedback & Coaching | Server | Groq Llama 3.3 70B | Final `Report` (markdown sections + scores) |

### Data flow per turn

1. Candidate speaks/types in browser.
2. Browser flushes `AudioMetrics` (Web Audio) + `VisualMetrics` (MediaPipe) → POST `/api/interview/turn`.
3. Server persists candidate turn, then **in parallel** runs Agents 3 (audio LLM scoring), 4 (deterministic CV math), 5 (technical LLM scoring).
4. Server persists per-dimension `agent_evaluations` rows and computes 2-turn trends.
5. Agent 2 (Orchestrator) decides next turn from profile + agenda + history + latest metrics + trends; adaptive heuristics force `drop_difficulty` on 2× low confidence, `ramp_difficulty` on 2× high correctness, `wrap_up` on time low.
6. Server returns next interviewer turn → browser renders + speaks via TTS → cycle.

## 3. Key design choices & trade-offs

| Decision | Why | Trade-off |
|---|---|---|
| **Browser-side multimodal capture + ML** | Privacy (raw frames never leave device), bandwidth (~2KB/turn vs MB/s of video), works on any laptop without GPU | Limited to Chrome/Edge for Web Speech; type-instead fallback always available |
| **Single base model (Llama 3.3 70B), six system prompts** | One latency profile, one cost profile, easy ops; system prompts are versioned `.md` files | If we ever need different models per agent (e.g., a vision LLM), we'd need router changes |
| **Multi-provider router (Groq → Gemini → Ollama)** | Auto-fallback if Groq hits rate limit; demo never hard-fails | Adds a tiny abstraction layer, but each provider is ~80 LOC |
| **Async non-blocking evaluators** | Audio + visual + technical scoring run in parallel with the next-question generation, so candidate-facing latency is dominated by ONE LLM call (~1-2s on Groq) | Marginally more wall-clock time per turn but feels conversational |
| **Pretrained CV (MediaPipe), not an LLM** | Per the spec; faster (15-30 FPS), cheaper (free), more deterministic for body-language signals | LLM could give richer interpretation, but we get that in Agent 6 from the aggregated metrics |
| **No auth in prototype (HMAC cookie)** | Removes signup friction for the demo; cookie is HMAC-signed so identity isn't forgeable | Loses returning-candidate dashboard; magic-link in v2 |
| **Vercel + cloud LLM APIs (no local tunnel)** | No laptop dependency, real public URL, low international latency | Requires LLM API keys in env; the optional `OLLAMA_BASE_URL` keeps an offline path |

## 4. Scoring approach

### Per-turn scoring

- **Audio (Agent 3):** browser computes `AudioMetrics` (WPM, fillers/min, pause ratio, pitch mean+variance, RMS, silence%); LLM grades `confidence` and `clarity` with a rubric. Confidence is high when WPM 110-160, fillers <2/min, healthy pitch variance, low silence%.
- **Visual (Agent 4):** browser computes `VisualMetrics` from MediaPipe (eye-contact ratio, head-pose stability, posture symmetry, smile/brow/jaw blendshapes, blink rate). Server applies a **deterministic** weighted formula:
  - `engagement = 0.5 + 0.25*(eye_contact - 0.5) + 0.15*(smile + brow_raise) + 0.10*(stability - 0.5)`
  - `stress = 0.5*jaw_tension + 0.3*(1 - eye_contact) + 0.2*(1 - stability)`
- **Technical (Agent 5):** LLM scores the candidate's answer to the previous question on `correctness` × `depth` × `specificity` × `concept_coverage`, with `evidence_quote` mandatory and `flags` for hallucinations / contradictions / off-topic / insufficient detail.

### Aggregation into the final report

Agent 6 receives the full transcript + all per-turn evaluations. It computes per-dimension averages, finds extreme moments (the most-extreme scores it can quote), and produces:

- `summary_md` (2 sentences)
- `scores`: per-dimension (technical/communication/confidence/engagement, 0-100)
- `overall = 0.35*technical + 0.30*communication + 0.20*confidence + 0.15*engagement` (recomputed server-side after the LLM returns, to enforce the formula)
- `strengths_md`, `improvements_md`, `behavioral_insights_md`, `next_steps_md` — all markdown, all required to quote evidence from the transcript

## 5. Limitations, assumptions, next steps

**Limitations**
- **Browser support:** Web Speech API and MediaPipe both require Chrome / Edge / Safari. Firefox has no Web Speech.
- **Concurrency:** Groq free tier is 30 RPM; sustained concurrent interviews would need paid tiers or a queue.
- **PDF-only resumes:** docx/txt support would need additional parsing logic (Gemini handles PDF natively today).
- **Single language:** prompts and STT default to English; multilingual support is a v2 swap.
- **No real-time interruption:** the candidate must finish their turn before the next interviewer turn fires.

**Assumptions**
- Candidate has a webcam, decent lighting, and a quiet environment.
- Modern browser (Chromium-based recommended).
- LLM providers have at least one of (Groq, Gemini) reachable from the deployment.

**Next steps (v2 roadmap)**
- Magic-link auth (Supabase) for returning candidates with history.
- Deepgram + ElevenLabs for broadcast-quality voice (cross-browser).
- Claude Sonnet 4.6 as a third provider for higher-quality reports.
- Agent-decision audit log for compliance.
- Eval harness with golden interviews + LLM-as-judge regression tests on every prompt change.
- Multi-tenant scaling (Upstash Redis rate limiting + warm model worker pool).
