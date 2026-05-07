/**
 * Careers grid — server component, reads from the live database.
 * Each card links to the role detail page.
 */
import Link from 'next/link';
import { Nav } from '@/components/iphipi/nav';
import { Footer } from '@/components/iphipi/footer';
import { ArrowRight } from 'lucide-react';
import { listJobs } from '@/lib/storage/db';

// Always render fresh — jobs may be reseeded between requests in dev.
export const dynamic = 'force-dynamic';

export default async function CareersPage() {
  const jobs = await listJobs();

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-7xl px-6 pt-16 pb-24">
        <div className="text-center">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            <span className="text-gradient">Open roles at IPHIPI</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            {jobs.length} hand-picked roles. Not sure which fits? Upload your
            resume on{' '}
            <Link href="/match-me" className="text-foreground underline-offset-4 hover:underline">
              the match-me page
            </Link>{' '}
            and we'll rank them for you.
          </p>
        </div>

        {jobs.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {jobs.map((j) => (
              <Link
                key={j.id}
                href={`/careers/${j.slug}`}
                className="glass group p-6 transition hover:bg-white/[0.05]"
              >
                <div className="text-xs uppercase tracking-wider text-brand-300">
                  {j.department} · {j.level}
                </div>
                <div className="mt-2 text-lg font-semibold text-foreground">
                  {j.title}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{j.location}</div>
                <div className="mt-6 inline-flex items-center gap-2 text-sm text-brand-300 transition group-hover:gap-3">
                  View role <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function EmptyState() {
  return (
    <div className="glass mx-auto mt-12 max-w-md p-8 text-center text-sm text-muted-foreground">
      No jobs in the database yet. Run{' '}
      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs">
        npm run setup
      </code>{' '}
      to seed the demo roles.
    </div>
  );
}
