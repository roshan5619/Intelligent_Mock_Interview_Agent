/**
 * GET /api/health
 *
 * Diagnostic endpoint that reports which env vars the deployed function
 * actually sees. NEVER returns the values — only booleans + lengths so we
 * can tell "missing" from "empty string" from "present".
 *
 * Safe to keep in production for ops debugging.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const KEYS = [
  'GROQ_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'BLOB_READ_WRITE_TOKEN',
  'HMAC_SECRET',
  'OLLAMA_BASE_URL',
] as const;

export async function GET() {
  const env: Record<string, { present: boolean; length: number; preview: string }> = {};
  for (const k of KEYS) {
    const v = process.env[k];
    env[k] = {
      present: typeof v === 'string',
      length: v?.length ?? 0,
      // First 8 chars only — not enough to leak a secret but enough to spot
      // accidental whitespace / wrong copy-paste.
      preview: v ? v.slice(0, 8) + '…' : '',
    };
  }
  // Try to actually open a DB connection from THIS function's runtime, to
  // prove that lib/storage/db.ts has access to the env in a request context.
  let db_test: { ok: boolean; error?: string; jobs_count?: number } = { ok: false };
  try {
    const { listJobs } = await import('@/lib/storage/db');
    const jobs = await listJobs();
    db_test = { ok: true, jobs_count: jobs.length };
  } catch (err) {
    db_test = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json({
    runtime: 'nodejs',
    is_vercel: Boolean(process.env.VERCEL),
    vercel_env: process.env.VERCEL_ENV ?? null,
    cwd: process.cwd(),
    env,
    db_test,
  });
}
