/**
 * Job detail page — full JD + Apply CTA.
 * Server component, reads job by slug from DB.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Nav } from '@/components/iphipi/nav';
import { Footer } from '@/components/iphipi/footer';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, MapPin, Building2, Sparkles } from 'lucide-react';
import { getJobBySlug } from '@/lib/storage/db';

export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;

export default async function JobDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job) notFound();

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl px-6 pt-12 pb-24">
        <Link
          href="/careers"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All roles
        </Link>

        {/* Header */}
        <div className="mt-8">
          <div className="text-xs uppercase tracking-wider text-brand-300">
            {job.department} · {job.level}
          </div>
          <h1 className="mt-2 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            <span className="text-gradient">{job.title}</span>
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> {job.location}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> {job.department}
            </span>
          </div>
        </div>

        {/* JD body */}
        <article className="prose prose-invert mt-10 max-w-none text-foreground/90">
          <JdMarkdown md={job.jdMd} />
        </article>

        {/* Apply CTA */}
        <div className="glass-strong mt-12 p-8 text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-brand-300" />
            Resume required · Match score in &lt;25s
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight">
            Apply with your resume
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            We'll parse your resume, score it against this role, and prepare a
            personalized mock interview before you talk to anyone.
          </p>
          <div className="mt-6">
            <Link href={`/apply/${job.slug}`}>
              <Button size="lg" className="gap-2">
                Apply now <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

/**
 * Tiny markdown renderer — we only support headings, paragraphs, and bullet
 * lists (which is all our JDs use). Avoids pulling a full markdown lib.
 */
function JdMarkdown({ md }: { md: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = md.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('### ')) {
      blocks.push(
        <h3 key={key++} className="mt-8 text-lg font-semibold text-foreground">
          {line.slice(4)}
        </h3>
      );
      i++;
    } else if (line.startsWith('## ')) {
      blocks.push(
        <h2 key={key++} className="mt-10 text-xl font-semibold text-foreground">
          {line.slice(3)}
        </h2>
      );
      i++;
    } else if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <ul key={key++} className="mt-3 space-y-1.5 pl-5 marker:text-brand-300">
          {items.map((item, idx) => (
            <li key={idx} className="list-disc text-sm text-foreground/85">
              {item}
            </li>
          ))}
        </ul>
      );
    } else if (line.trim() === '') {
      i++;
    } else {
      blocks.push(
        <p key={key++} className="mt-3 text-sm leading-relaxed text-foreground/80">
          {line}
        </p>
      );
      i++;
    }
  }

  return <>{blocks}</>;
}
