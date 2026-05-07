/**
 * /match-me/results/[runId] — render the ranked roles for a given match run.
 * Auth: candidate cookie must own the run (otherwise 404).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { Nav } from '@/components/iphipi/nav';
import { Footer } from '@/components/iphipi/footer';
import { MatchScoreRing } from '@/components/iphipi/match-score-ring';
import { ArrowRight, Check, Minus, Trophy } from 'lucide-react';
import { getLatestRoleMatchRun } from '@/lib/storage/db';
import { createClient } from '@libsql/client';
import {
  CANDIDATE_COOKIE_NAME,
  verifyCandidateToken,
} from '@/lib/auth/candidate-token';
import type { RoleMatchResult } from '@/lib/storage/types';

export const dynamic = 'force-dynamic';

type Params = Promise<{ runId: string }>;

export default async function ResultsPage({ params }: { params: Params }) {
  const { runId } = await params;

  // Identify candidate
  const cookieStore = await cookies();
  const candidateId = verifyCandidateToken(
    cookieStore.get(CANDIDATE_COOKIE_NAME)?.value
  );
  if (!candidateId) notFound();

  // Fetch the specific run by id (verify ownership)
  const run = await fetchRun(runId, candidateId);
  if (!run) notFound();

  const top = run.results[0];
  const rest = run.results.slice(1);

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl px-6 pt-12 pb-24">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/5 px-4 py-1.5 text-xs text-emerald-300">
            <Trophy className="h-3.5 w-3.5" /> Ranking complete
          </div>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            <span className="text-gradient">Roles ranked for you</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            We scored every open IPHIPI role against your resume. The top match is shown first; click any role to see the full JD and apply.
          </p>
        </div>

        {/* Top result: bigger card */}
        {top && <TopCard result={top} />}

        {/* The rest */}
        {rest.length > 0 && (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {rest.map((r) => (
              <ResultCard key={r.jobId} result={r} />
            ))}
          </div>
        )}

        <div className="mt-12 text-center text-sm text-muted-foreground">
          Want to interview against a specific role?{' '}
          <Link href="/careers" className="text-foreground underline-offset-4 hover:underline">
            Browse all roles
          </Link>{' '}
          or click any card above.
        </div>
      </main>
      <Footer />
    </>
  );
}

/* ---------------------------------------------------------------- pieces */

function TopCard({ result }: { result: RoleMatchResult }) {
  return (
    <Link
      href={`/apply/${result.jobSlug}`}
      className="glass-strong group mt-12 grid gap-8 p-8 transition hover:bg-white/[0.05] md:grid-cols-[200px,1fr] md:items-center md:p-10"
    >
      <MatchScoreRing score={result.score} className="mx-auto" size={180} />
      <div>
        <div className="text-xs uppercase tracking-wider text-brand-300">
          {result.department} · {result.level} · best match
        </div>
        <div className="mt-1 text-2xl font-semibold text-foreground">
          {result.jobTitle}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">
          {result.whyFitsMd}
        </p>
        <Chips matched={result.breakdown.matched} gaps={result.breakdown.gaps} />
        <div className="mt-5 inline-flex items-center gap-2 text-sm text-brand-300 transition group-hover:gap-3">
          Apply for this role <ArrowRight className="h-3.5 w-3.5" />
        </div>
      </div>
    </Link>
  );
}

function ResultCard({ result }: { result: RoleMatchResult }) {
  return (
    <Link
      href={`/apply/${result.jobSlug}`}
      className="glass group flex flex-col gap-4 p-6 transition hover:bg-white/[0.05]"
    >
      <div className="flex items-start gap-4">
        <MatchScoreRing score={result.score} size={96} />
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wider text-brand-300">
            {result.department} · {result.level}
          </div>
          <div className="mt-1 text-base font-semibold text-foreground">
            {result.jobTitle}
          </div>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-foreground/80">
        {result.whyFitsMd}
      </p>
      <Chips matched={result.breakdown.matched} gaps={result.breakdown.gaps} compact />
      <div className="mt-auto inline-flex items-center gap-2 text-sm text-brand-300 transition group-hover:gap-3">
        View role <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  );
}

function Chips({
  matched,
  gaps,
  compact,
}: {
  matched: string[];
  gaps: string[];
  compact?: boolean;
}) {
  const matchedShown = matched.slice(0, compact ? 4 : 8);
  const gapsShown = gaps.slice(0, compact ? 2 : 4);
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {matchedShown.map((m) => (
        <span
          key={m}
          className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-500/5 px-2 py-0.5 text-xs text-emerald-200"
        >
          <Check className="h-3 w-3" />
          {m}
        </span>
      ))}
      {gapsShown.map((g) => (
        <span
          key={g}
          className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-500/5 px-2 py-0.5 text-xs text-amber-200"
        >
          <Minus className="h-3 w-3" />
          {g}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- data */

/**
 * Fetch the specific run by ID and verify the cookie owns it. We don't have a
 * `getRoleMatchRun(id)` helper yet; do the small query inline to keep the
 * change focused.
 */
async function fetchRun(runId: string, candidateId: string) {
  // Reuse the existing libSQL connection by way of a fresh client (cheap).
  let url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    const { resolve } = await import('node:path');
    url = `file:${resolve(process.cwd(), 'data', 'iphipi.db')}`;
  }
  const c = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const r = await c.execute({
    sql: 'SELECT * FROM role_match_runs WHERE id = ? AND candidate_id = ?',
    args: [runId, candidateId],
  });
  if (!r.rows[0]) {
    // Fall back to "latest run for this candidate" so a stale URL still shows
    // the freshest results rather than a 404.
    return getLatestRoleMatchRun(candidateId);
  }
  const row = r.rows[0] as Record<string, unknown>;
  return {
    id: String(row.id),
    candidateId: String(row.candidate_id),
    scoredAt: Number(row.scored_at),
    results: JSON.parse(String(row.results_json)) as RoleMatchResult[],
  };
}
