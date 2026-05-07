/**
 * /interview/[sessionId]/report — post-interview coaching report.
 * Server-rendered. Renders the markdown sections produced by Agent 6.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { Nav } from '@/components/iphipi/nav';
import { Footer } from '@/components/iphipi/footer';
import { MatchScoreRing } from '@/components/iphipi/match-score-ring';
import { ArrowLeft, Sparkles, Trophy, AlertCircle, Compass, ListTodo } from 'lucide-react';
import {
  getApplication,
  getInterviewSession,
  getReportBySession,
} from '@/lib/storage/db';
import {
  CANDIDATE_COOKIE_NAME,
  verifyCandidateToken,
} from '@/lib/auth/candidate-token';

export const dynamic = 'force-dynamic';

type Params = Promise<{ sessionId: string }>;

export default async function ReportPage({ params }: { params: Params }) {
  const { sessionId } = await params;

  const cookieStore = await cookies();
  const candidateId = verifyCandidateToken(
    cookieStore.get(CANDIDATE_COOKIE_NAME)?.value
  );
  if (!candidateId) notFound();

  const session = await getInterviewSession(sessionId);
  if (!session) notFound();
  const application = await getApplication(session.applicationId);
  if (!application || application.candidateId !== candidateId) notFound();

  const report = await getReportBySession(sessionId);
  if (!report) {
    return <NotReadyView sessionId={sessionId} />;
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl px-6 pt-12 pb-24">
        <Link
          href={`/candidate/${application.id}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to candidate
        </Link>

        {/* Headline */}
        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/5 px-4 py-1.5 text-xs text-emerald-300">
            <Trophy className="h-3.5 w-3.5" /> Interview complete · {session.targetRole}
          </div>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            <span className="text-gradient">Your interview report</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-foreground/85">
            {report.summaryMd}
          </p>
        </div>

        {/* Headline scores */}
        <div className="glass-strong mt-12 grid gap-8 p-8 md:grid-cols-[200px_1fr] md:items-center md:p-10">
          <MatchScoreRing score={report.scores.overall} size={180} className="mx-auto" />
          <div className="grid gap-3">
            <ScoreBar label="Technical" value={report.scores.technical} />
            <ScoreBar label="Communication" value={report.scores.communication} />
            <ScoreBar label="Confidence" value={report.scores.confidence} />
            <ScoreBar label="Engagement" value={report.scores.engagement} />
          </div>
        </div>

        {/* Strengths */}
        <Section
          title="Strengths"
          icon={<Sparkles className="h-4 w-4 text-emerald-300" />}
          accent="emerald"
        >
          <Markdown md={report.strengthsMd} />
        </Section>

        {/* Improvements */}
        <Section
          title="Where to improve"
          icon={<AlertCircle className="h-4 w-4 text-amber-300" />}
          accent="amber"
        >
          <Markdown md={report.improvementsMd} />
        </Section>

        {/* Behavioral insights */}
        <Section
          title="Behavioral insights"
          icon={<Compass className="h-4 w-4 text-brand-300" />}
          accent="brand"
        >
          <Markdown md={report.behavioralInsightsMd} />
        </Section>

        {/* Next steps */}
        <Section
          title="Next steps this week"
          icon={<ListTodo className="h-4 w-4 text-brand-300" />}
          accent="brand"
        >
          <Markdown md={report.nextStepsMd} />
        </Section>

        <div className="mt-12 text-center text-xs text-muted-foreground">
          Want to try a different role?{' '}
          <Link href="/match-me" className="text-foreground underline-offset-4 hover:underline">
            Re-rank IPHIPI roles for your resume
          </Link>
          .
        </div>
      </main>
      <Footer />
    </>
  );
}

/* ---------------- pieces ---------------- */

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-foreground">{Math.round(value)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  accent,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accent: 'emerald' | 'amber' | 'brand';
  children: React.ReactNode;
}) {
  const accentClass =
    accent === 'emerald'
      ? 'text-emerald-300'
      : accent === 'amber'
      ? 'text-amber-300'
      : 'text-brand-300';
  return (
    <section className="glass mt-6 p-7">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className={'text-sm font-semibold uppercase tracking-wider ' + accentClass}>
          {title}
        </h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function NotReadyView({ sessionId }: { sessionId: string }) {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-2xl px-6 pt-24 pb-24">
        <div className="glass p-12 text-center">
          <div className="mx-auto h-12 w-12 animate-pulse rounded-full bg-brand-500/20" />
          <h1 className="mt-6 text-2xl font-semibold">Report still generating…</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Agent 6 is aggregating every signal from your session. Refresh in a few seconds.
          </p>
          <div className="mt-6 text-xs text-muted-foreground">
            Session: <span className="font-mono">{sessionId.slice(0, 8)}…</span>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

/* ---------------- minimal markdown renderer for our report sections ---------------- */
/* Supports headings (### / ####), paragraphs, bullet lists, **bold**.            */

function Markdown({ md }: { md: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = md.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('#### ')) {
      blocks.push(
        <h4 key={key++} className="mt-5 text-sm font-semibold text-foreground">
          {renderInline(line.slice(5))}
        </h4>
      );
      i++;
    } else if (line.startsWith('### ')) {
      blocks.push(
        <h3 key={key++} className="mt-6 text-base font-semibold text-foreground">
          {renderInline(line.slice(4))}
        </h3>
      );
      i++;
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <ul key={key++} className="mt-2 space-y-1.5 pl-5 marker:text-brand-300">
          {items.map((item, idx) => (
            <li key={idx} className="list-disc text-sm leading-relaxed text-foreground/85">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
    } else if (line.trim() === '') {
      i++;
    } else {
      blocks.push(
        <p key={key++} className="mt-2 text-sm leading-relaxed text-foreground/85">
          {renderInline(line)}
        </p>
      );
      i++;
    }
  }

  return <>{blocks}</>;
}

function renderInline(s: string): React.ReactNode {
  // **bold** → <strong>
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>;
    }
    return <span key={i}>{p}</span>;
  });
}
