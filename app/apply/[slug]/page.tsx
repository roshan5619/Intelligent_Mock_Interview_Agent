/**
 * Apply page — resume upload form for a specific role.
 * Hybrid: server-rendered shell + client form for the upload + progress UI.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Nav } from '@/components/iphipi/nav';
import { Footer } from '@/components/iphipi/footer';
import { ArrowLeft } from 'lucide-react';
import { getJobBySlug } from '@/lib/storage/db';
import { ApplyForm } from '@/components/iphipi/apply-form';

export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;

export default async function ApplyPage({ params }: { params: Params }) {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job) notFound();

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-2xl px-6 pt-12 pb-24">
        <Link
          href={`/careers/${job.slug}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to role
        </Link>

        <div className="mt-8">
          <div className="text-xs uppercase tracking-wider text-brand-300">
            Apply · {job.department} · {job.level}
          </div>
          <h1 className="mt-2 text-balance text-4xl font-semibold tracking-tight">
            <span className="text-gradient">{job.title}</span>
          </h1>
          <p className="mt-4 text-muted-foreground">
            Upload your resume — we'll parse it, score it against this role, and
            prepare a tailored mock interview.
          </p>
        </div>

        <ApplyForm jobId={job.id} jobSlug={job.slug} jobTitle={job.title} />
      </main>
      <Footer />
    </>
  );
}
