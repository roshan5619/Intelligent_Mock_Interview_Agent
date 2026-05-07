# Runbook

Operational reference for running, deploying, and demoing IPHIPI.

## Local development

### First-time setup

```powershell
# Clone + install
git clone https://github.com/roshan5619/Intelligent_Mock_Interview_Agent.git
cd Intelligent_Mock_Interview_Agent
npm install

# Env
Copy-Item .env.example .env.local
# Open .env.local and paste:
#   GROQ_API_KEY=gsk_...                       (https://console.groq.com)
#   GOOGLE_GENERATIVE_AI_API_KEY=AIza...       (https://aistudio.google.com/apikey)
#   HMAC_SECRET=...                            (generate locally; one-liner below)

# Generate HMAC secret in PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))

# Apply schema + seed jobs
npm run setup

# Verify
npm run check:env

# Run
npm run dev
# → http://localhost:3000
```

### Daily dev loop

```powershell
npm run dev          # Next.js dev server
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
```

### Reset local DB

```powershell
Remove-Item data\iphipi.db -ErrorAction SilentlyContinue
npm run setup
```

---

## Deployment to Vercel

### One-time

```powershell
npm i -g vercel
vercel link
# Accept defaults; choose your account; "link to existing?" → No
```

### Set production env vars

In the Vercel dashboard → Project Settings → Environment Variables, add:

| Variable | Value | Required |
|---|---|---|
| `GROQ_API_KEY` | from console.groq.com | yes |
| `GOOGLE_GENERATIVE_AI_API_KEY` | from aistudio.google.com/apikey | yes |
| `HMAC_SECRET` | locally generated base64 | yes |
| `TURSO_DATABASE_URL` | from turso.tech (libsql://...) | **yes** (Vercel filesystem is read-only) |
| `TURSO_AUTH_TOKEN` | from `turso db tokens create` | yes |
| `BLOB_READ_WRITE_TOKEN` | from Vercel → Storage → Blob | yes |

Apply the schema once against Turso:
```powershell
# After TURSO_* vars are set in your local .env.local, run:
npm run setup
# This applies db/schema.sql to Turso and seeds the 6 jobs.
```

### Deploy

```powershell
vercel --prod
```

### Continuous deploy from GitHub

Vercel auto-deploys on every push to `main` once you've linked the repo. The default workflow is sufficient for the prototype.

---

## Demo-day checklist (5 min before stakeholders join)

- [ ] Use **Chrome (latest)** — required for Web Speech + MediaPipe
- [ ] Plug in webcam, ensure good front-lighting
- [ ] Use a quiet room or a headset mic
- [ ] Wired ethernet preferred over Wi-Fi
- [ ] Open the live Vercel URL → do one full dry-run end-to-end
- [ ] Have the screen-recording from yesterday as a backup

### Demo flow (3-4 min)

1. **Land on `/`** — show the value-prop hero + pillars (10 s)
2. **Click "Match my resume"** → upload `samples/resumes/senior-backend.pdf` → wait ~20s → show ranked roles (1 min)
3. **Click the top result → Apply** — show fit score + breakdown + matched/gaps chips (30 s)
4. **Click "Start mock interview"** — grant camera/mic, watch warmup, do 3-4 turns (2 min)
   - Demonstrate voice mode AND text mode
   - Point out the agent presence rail (audio listening, vision analyzing, tech evaluating)
5. **Click "End & see report"** — wait ~10s → show per-dimension scores + coaching (45 s)

---

## Troubleshooting

| Issue | Diagnosis | Fix |
|---|---|---|
| `npm run dev` fails with "Cannot find module 'next'" | Dependencies not installed | `npm install` |
| Apply returns 500 with "GOOGLE_GENERATIVE_AI_API_KEY is not set" | Missing key | Add to `.env.local`, restart dev server |
| Apply returns 500 from Gemini | Quota or invalid key | Check Google AI Studio → API keys; rotate |
| Match scores all show 50% | Embeddings failed (network or key) | Check Gemini key; the router falls back to a neutral 0.5 if embeddings unavailable |
| Interview stuck in "Calibrating…" | MediaPipe model fetch blocked | Open DevTools → Network → look for `face_landmarker.task` 403/404. Check firewall / corp proxy |
| "Speak" button does nothing | Browser doesn't support SpeechRecognition | Switch to "Type" mode (always available) |
| Interviewer voice plays but nothing happens after speaking | STT timed out OR permission revoked | Click "Stop" then "Speak" again; refresh if needed |
| Report page says "still generating" forever | Agent 6 LLM call failed | Check dev-server console; refresh once. If persistent, Groq+Gemini both failed |
| Vercel deploy: function timeout | Free tier 10s limit | Upgrade to Pro for the interview routes (`maxDuration = 60`) |

---

## Observability

Local: dev server console prints every LLM call's provider, model, and duration via `lib/llm/client.ts` warning logs (only when fallback fires).

Production: Vercel function logs are accessible at vercel.com/dashboard → project → Functions tab.

For richer instrumentation, the v2 plan adds Sentry + PostHog (see [ARCHITECTURE.md §5](./ARCHITECTURE.md#5-limitations-assumptions-next-steps)).

---

## Useful one-liners

```powershell
# See what providers are configured
npm run check:env

# Re-seed jobs without nuking data
npm run setup

# Type-check everything
npm run typecheck

# Hit the live API from a script
$body = @{ applicationId = "01J..." } | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:3000/api/interview/start -Method Post -ContentType 'application/json' -Body $body

# Check Groq key works
curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $env:GROQ_API_KEY"
```
