# IPHIPI — Agentic AI Mock Interview Platform

> A multimodal mock-interview platform for senior professionals. Upload your resume → infer the roles you can land → conduct a live 6-agent video + audio interview → receive specific, actionable coaching. **All on free SOTA models** (Groq Llama 3.3 70B + Google Gemini 2.0 Flash + browser-native MediaPipe / Web Audio).

---

## What's in here

```
You upload a resume
        ↓
Agent 1 (Context Understanding) reads it with Gemini 2.0 Flash (native PDF)
        ↓
JD-Match scores you against every IPHIPI role (embedding + skill overlap + seniority)
        ↓
You pick a role → start a live mock interview
        ↓
┌─────────────────── Live multimodal interview ───────────────────┐
│  Agent 2 — Orchestrator    decides each next question            │
│  Agent 3 — Audio Intel.    scores confidence + clarity           │
│  Agent 4 — Visual Intel.   reads eye contact, posture, expression│
│  Agent 5 — Tech Eval.      grades correctness, depth, specificity│
└──────────────────────────────────────────────────────────────────┘
        ↓
Agent 6 (Feedback & Coaching) writes your report
        ↓
You see per-dimension scores, evidence quotes, and concrete next steps
```

---

## Quick start (5 commands)

> Prerequisites: **Node 20+**, a free **Groq** key, a free **Google AI Studio** key. Everything else is optional and falls back to local files for development.

```powershell
# 1. Clone
git clone https://github.com/roshan5619/Intelligent_Mock_Interview_Agent.git
cd Intelligent_Mock_Interview_Agent

# 2. Set up env
Copy-Item .env.example .env.local
# → open .env.local and paste your GROQ_API_KEY + GOOGLE_GENERATIVE_AI_API_KEY
# → also paste an HMAC_SECRET (generate one with the PowerShell line below)

# 3. Generate an HMAC secret
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))

# 4. Install + initialize the database (auto-uses local SQLite at ./data/iphipi.db)
npm install
npm run setup

# 5. Run
npm run dev
# → open http://localhost:3000 in Chrome
```

You're done. The full flow works locally with **only Groq + Gemini keys + an HMAC secret**.

---

## Get the API keys (3-5 minutes)

| Service | URL | What you copy | Where it goes in `.env.local` |
|---|---|---|---|
| **Groq Cloud** | https://console.groq.com → API Keys → Create | key starting `gsk_...` | `GROQ_API_KEY=` |
| **Google AI Studio** | https://aistudio.google.com/apikey → Create API key | key starting `AIza...` | `GOOGLE_GENERATIVE_AI_API_KEY=` |
| **HMAC secret** | (generated locally — see step 3 above) | base64 string | `HMAC_SECRET=` |

These three keys are **all you need** for local development.

For Vercel deployment you also want:
- **Turso** (managed SQLite) — sign up at https://turso.tech, create a DB, copy URL + token. Or skip — defaults to a local SQLite file in `./data/`.
- **Vercel Blob** (resume storage) — auto-provisioned when you `vercel link`. Or skip — defaults to `./data/uploads/`.

---

## What you can do

| Page | What happens |
|---|---|
| `http://localhost:3000` | Marketing landing |
| `/careers` | Browse 6 seeded IPHIPI roles |
| `/careers/staff-backend` | Job detail + apply CTA |
| `/match-me` | Upload resume → get all 6 roles ranked for you |
| `/apply/staff-backend` | Apply to a specific role → see fit score |
| `/candidate/[id]` | Your post-apply view → "Start mock interview" |
| `/interview/[sessionId]` | The live multimodal interview |
| `/interview/[sessionId]/report` | Coaching report after the session |

---

## Project structure

```
app/                              # Next.js App Router pages + API routes
  (marketing)/  page.tsx, careers/, match-me/, apply/, candidate/
  (interview)/  interview/[sessionId]/, .../report/
  api/          apply/, match/rank-all/, interview/start, interview/turn, interview/end

lib/
  agents/                         # ★ ONE FILE PER AGENT (six total)
    context-understanding.ts      # Agent 1 — resume → ContextProfile (Gemini PDF)
    orchestrator.ts               # Agent 2 — next-question decision + adaptive rules
    audio-intelligence.ts         # Agent 3 — score browser audio metrics
    visual-intelligence.ts        # Agent 4 — score MediaPipe metrics (deterministic)
    technical-evaluation.ts       # Agent 5 — semantic answer scoring
    feedback-coaching.ts          # Agent 6 — final report generator
    agenda.ts                     # Heuristic agenda planner
  prompts/                        # Versioned .md system prompts (one per agent)
  llm/
    client.ts                     # Multi-provider router (Groq → Gemini → Ollama)
    providers/                    # Per-provider SDK adapters
    config.ts                     # Per-agent sampling params + preferred provider
  matching/
    jd-match.ts                   # Hybrid score: embedding + skill overlap + seniority
    rank-all.ts                   # Score one resume against every IPHIPI job
  embeddings/similarity.ts        # Cosine sim, mean-pool helpers
  storage/
    db.ts                         # libSQL DAL (auto-falls-back to local SQLite)
    blob.ts                       # Vercel Blob (auto-falls-back to local FS)
    types.ts                      # All entity TS shapes
  auth/candidate-token.ts         # HMAC-signed cookie (no auth in prototype)
  voice/
    audio-analyzer.ts             # Browser: Web Audio API → AudioMetrics
    speech.ts                     # Browser: SpeechRecognition + SpeechSynthesis
  vision/
    mediapipe-loader.ts           # Browser: lazy-load FaceLandmarker + PoseLandmarker
    metrics-aggregator.ts         # Browser: per-frame → per-turn VisualMetrics
  actions/apply.ts                # Server action: orchestrates the apply pipeline

components/
  ui/button.tsx                   # Variants: default | secondary | ghost | outline
  iphipi/                         # Branded composites
    nav.tsx, footer.tsx
    apply-form.tsx, match-me-form.tsx
    match-score-ring.tsx          # Animated SVG ring
    start-interview-button.tsx
    interview-workspace.tsx       # ★ The live interview UI (~600 LOC)

db/
  schema.sql                      # libSQL/Postgres-compatible schema
  seed/jobs.json                  # The 6 IPHIPI demo roles

scripts/
  setup.ts                        # npm run setup → migrate + seed (idempotent)
  check-env.ts                    # npm run check:env → reports config status
```

### How the agents interact (one turn)

```
candidate speaks/types
       │
       ▼
[client] flush AudioMetrics (Web Audio) + VisualMetrics (MediaPipe)
       │
       ▼  POST /api/interview/turn
[server] persist candidate turn
       │
       ├──► Agent 3 (Audio Intel)        ─┐
       ├──► Agent 4 (Visual Intel)       ─┤  PARALLEL
       ├──► Agent 5 (Technical Eval)     ─┘
       │
       ▼  persist all per-dimension AgentEvaluation rows
[server] build trends → Agent 2 (Orchestrator) decides next turn
       │                ▲
       │                └─ adaptive heuristics (force drop_difficulty
       │                   on 2x low confidence, force ramp_difficulty
       │                   on 2x high correctness, force wrap_up on time low)
       │
       ▼  return next interviewer turn + scores
[client] render question, speak via TTS, loop
```

At end-of-session, **Agent 6** runs once over the whole transcript + all evaluations and writes the final report.

---

## Sample inputs and expected outputs

See [`samples/`](./samples/):

- `samples/resumes/senior-backend.pdf` — fictional 15-yr backend engineer resume
- `samples/expected-outputs/senior-backend__match.json` — expected JD-match output structure
- `samples/expected-outputs/senior-backend__report.md` — expected report shape

Run `npm run check:samples` to verify the pipeline against these fixtures (LLM outputs are non-deterministic — the script asserts structural validity, not exact match).

---

## Configuration

| `.env.local` key | Purpose | Required? |
|---|---|---|
| `GROQ_API_KEY` | Primary LLM (Llama 3.3 70B) | **Yes** (or Gemini) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | PDF parsing + embeddings | **Yes** (for resume parse) |
| `HMAC_SECRET` | Signs candidate cookie | **Yes** |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | Managed DB | No (local SQLite fallback) |
| `BLOB_READ_WRITE_TOKEN` | Resume file storage | No (local FS fallback) |
| `OLLAMA_BASE_URL` | Optional offline LLM | No (cloud fallback) |
| `NEXT_PUBLIC_APP_URL` | Public URL for metadata | Auto on Vercel |

Run **`npm run check:env`** any time to see which providers are configured.

---

## Deploy to Vercel

```powershell
# One-time
npm i -g vercel
vercel link

# Add all env vars to Vercel dashboard → Project Settings → Environment Variables
# (Vercel filesystem is read-only, so you MUST set TURSO + BLOB env vars for production)

# Deploy
vercel --prod
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm run dev` fails immediately | Check Node version: `node -v` should be ≥ 20 |
| `npm run check:env` says no LLM provider | At least one of `GROQ_API_KEY`/`GOOGLE_GENERATIVE_AI_API_KEY` must be set |
| Resume upload returns 500 | Open the dev-server terminal — most likely `GOOGLE_GENERATIVE_AI_API_KEY` missing or invalid (Gemini natively reads the PDF) |
| Camera/mic doesn't work | Use Chrome or Edge. Firefox doesn't support Web Speech API |
| Interview answers are slow | Groq free tier is 30 RPM — bursts queue. Each turn calls 2-3 LLMs. ~3-6s per turn is normal |
| Match score is `null` after apply | Resume parse may have failed — check the candidate page after ~25 s; refresh once |
| MediaPipe slow / janky | Frame loop is throttled to 15 FPS. On low-end laptops, switch to "Type" mode for the interview |
| Vercel deploys but interview hangs | Vercel free tier has a 10s function timeout. Upgrade to Pro for `maxDuration = 60`, or stay on free for the resume-parse + match-me flow only |

---

## Tech stack

| Layer | Tool | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | One repo, server actions, fast iteration |
| Hosting | Vercel | Edge CDN, free tier, GitHub auto-deploy |
| Language | TypeScript (strict) | Type safety across agents |
| Styling | Tailwind CSS + custom design tokens | Dark-first, glass surfaces |
| LLM (primary) | **Groq** Llama 3.3 70B Versatile | ~500 tok/s, free tier, near-frontier |
| LLM (PDF + embeddings) | **Google Gemini 2.0 Flash** + text-embedding-004 | Native PDF, generous free tier |
| Vision (CV) | **MediaPipe Tasks** (FaceLandmarker, PoseLandmarker, Blendshapes) | Pretrained, browser-native, free, on-device |
| Voice | **Web Speech API** (STT + TTS) + Web Audio API | Browser-native, zero infra |
| DB | Turso (libSQL) — falls back to local SQLite | SQLite-compatible managed |
| File storage | Vercel Blob — falls back to local FS | Free tier, signed URLs |
| Validation | zod | Strict agent IO contracts |

---


