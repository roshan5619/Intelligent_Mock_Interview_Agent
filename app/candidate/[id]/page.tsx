/**
 * Candidate post-apply page.
 * Shows: match score (animated ring), breakdown, matched skills, gaps,
 *        "why this fits" rationale, and the "Start Mock Interview" CTA.
 *
 * Verifies the candidate cookie owns this application — otherwise 404.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { Nav } from '@/components/iphipi/nav';
import { Footer } from '@/components/iphipi/footer';
import { MatchScoreRing } from '@/components/iphipi/match-score-ring';
import { StartInterviewButton } from '@/components/iphipi/start-interview-button';
import { Check, Minus, Sparkles, FileCheck2 } from 'lucide-react';
import {
  getApplication,
  getJob,
} from '@/lib/storage/db';
import {
  CANDIDATE_COOKIE_NAME,
  verifyCandidateToken,
} from '@/lib/auth/candidate-token';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export default async function CandidatePage({ params }: { params: Params }) {
  const { id } = await params;
  const application = await getApplication(id);
  if (!application) notFound();

  // Authorization: the cookie must match the application's candidate.
  const cookieStore = await cookies();
  const tokenCandidateId = verifyCandidateToken(
    cookieStore.get(CANDIDATE_COOKIE_NAME)?.value
  );
  if (tokenCandidateId !== application.candidateId) {
    notFound();
  }

  const job = application.jobId ? await getJob(application.jobId) : null;
  const breakdown = application.matchBreakdown;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl px-6 pt-12 pb-24">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/5 px-4 py-1.5 text-xs text-emerald-300">
            <FileCheck2 className="h-3.5 w-3.5" /> Application received
          </div>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            <span className="text-gradient">
              {job ? `Your fit for ${job.title}` : 'Your application'}
            </span>
          </h1>
        </div>

        {breakdown ? (
          <>
            {/* Score + rationale */}
            <div className="glass-strong mt-12 grid gap-8 p-8 md:grid-cols-[200px,1fr] md:items-center md:p-10">
              <MatchScoreRing score={breakdown.score} className="mx-auto" />
              <div>
                <p className="text-sm leading-relaxed text-foreground/90">
                  {breakdown.rationale}
                </p>
                <SubscoreBars breakdown={breakdown} />
              </div>
            </div>

            {/* Matched + gaps */}
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <ChipList
                title="What you bring"
                items={breakdown.matched}
                icon={<Check className="h-3.5 w-3.5 text-emerald-300" />}
                tone="positive"
              />
              <ChipList
                title="Where to expect probing"
                items={breakdown.gaps}
                icon={<Minus className="h-3.5 w-3.5 text-amber-300" />}
                tone="warn"
                emptyText="No must-have gaps detected — strong baseline."
              />
            </div>
          </>
        ) : (
          <ScoringInProgress />
        )}

        {/* CTA */}
        <div className="glass mt-12 p-8 text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-brand-300" />
            Six-agent multimodal interview · 8-12 minutes
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight">
            Ready when you are.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            We'll prepare a personalized agenda based on your resume and this
            role. You'll need a webcam and microphone.
          </p>
          <div className="mt-6 flex justify-center">
            <StartInterviewButton applicationId={application.id} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Browse other roles ranked for you on the{' '}
            <Link href="/match-me" className="text-foreground underline-offset-4 hover:underline">
              match-me page
            </Link>.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}

/* ---------------------------------------------------------------- pieces */

function SubscoreBars({
  breakdown,
}: {
  breakdown: NonNullable<Awaited<ReturnType<typeof getApplication>>>['matchBreakdown'];
}) {
  if (!breakdown) return null;
  const rows: { label: string; value: number }[] = [
    { label: 'Semantic similarity', value: breakdown.embedding_similarity },
    { label: 'Skill overlap', value: breakdown.skill_overlap },
    { label: 'Seniority fit', value: breakdown.seniority_fit },
  ];
  return (
    <div className="mt-6 space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{r.label}</span>
            <span className="font-mono tabular-nums">
              {Math.round(r.value * 100)}%
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300 transition-all"
              style={{ width: `${Math.round(r.value * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChipList({
  title,
  items,
  icon,
  tone,
  emptyText,
}: {
  title: string;
  items: string[];
  icon: React.ReactNode;
  tone: 'positive' | 'warn';
  emptyText?: string;
}) {
  return (
    <div className="glass p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{emptyText ?? 'None to show.'}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {items.slice(0, 12).map((it) => (
            <span
              key={it}
              className={
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ' +
                (tone === 'positive'
                  ? 'border-emerald-400/20 bg-emerald-500/5 text-emerald-200'
                  : 'border-amber-400/20 bg-amber-500/5 text-amber-200')
              }
            >
              {icon}
              {it}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoringInProgress() {
  return (
    <div className="glass mt-12 p-12 text-center">
      <div className="mx-auto h-12 w-12 animate-pulse rounded-full bg-brand-500/20" />
      <h2 className="mt-6 text-xl font-semibold">Scoring your fit…</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Refresh in a moment. (Resume parse + match runs in &lt; 25 s on the free
        Groq + Gemini tier.)
      </p>
    </div>
  );
}
