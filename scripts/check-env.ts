/**
 * `npm run check:env` — verify the .env.local has what we need.
 *
 * Prints a clear report of which providers are configured. The app will run
 * with at least ONE of (GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY) — the
 * other env vars are needed only for production features (DB, file upload).
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), '.env.local');
if (existsSync(envFile)) config({ path: envFile });

type Check = { key: string; required: boolean; purpose: string };
const CHECKS: Check[] = [
  { key: 'GROQ_API_KEY', required: false, purpose: 'Primary LLM (Groq Llama 3.3 70B)' },
  { key: 'GOOGLE_GENERATIVE_AI_API_KEY', required: false, purpose: 'PDF parsing + embeddings (Gemini)' },
  { key: 'TURSO_DATABASE_URL', required: false, purpose: 'Database (Turso libSQL)' },
  { key: 'TURSO_AUTH_TOKEN', required: false, purpose: 'Database auth' },
  { key: 'BLOB_READ_WRITE_TOKEN', required: false, purpose: 'Resume file storage (Vercel Blob)' },
  { key: 'HMAC_SECRET', required: false, purpose: 'Candidate cookie signing' },
  { key: 'OLLAMA_BASE_URL', required: false, purpose: 'Optional offline LLM fallback' },
];

console.log('\nIPHIPI environment check\n');

let hasLlm = false;
let warnings = 0;

for (const c of CHECKS) {
  const v = process.env[c.key];
  const set = Boolean(v && v.trim());
  const tag = set ? '  set' : 'unset';
  console.log(`  [${tag}]  ${c.key.padEnd(34)} ${c.purpose}`);
  if ((c.key === 'GROQ_API_KEY' || c.key === 'GOOGLE_GENERATIVE_AI_API_KEY') && set) {
    hasLlm = true;
  }
  if (c.required && !set) warnings++;
}

console.log('');
if (!hasLlm) {
  console.log('At least one of GROQ_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY must be set.');
  console.log('Sign up:');
  console.log('  Groq:   https://console.groq.com');
  console.log('  Gemini: https://aistudio.google.com/apikey');
  process.exit(1);
}
console.log('OK — at least one LLM provider is configured.\n');
process.exit(warnings > 0 ? 1 : 0);
