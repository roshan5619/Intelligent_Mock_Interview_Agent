/**
 * Placeholder careers grid — wired up to real data in a later step.
 * Today: shows the 6 demo roles with clean cards.
 */
import Link from 'next/link';
import { Nav } from '@/components/iphipi/nav';
import { Footer } from '@/components/iphipi/footer';
import { ArrowRight } from 'lucide-react';

const ROLES = [
  { slug: 'staff-backend', title: 'Staff Backend Engineer', dept: 'Engineering', level: 'Staff', loc: 'Remote · Global' },
  { slug: 'senior-frontend', title: 'Senior Frontend Engineer', dept: 'Engineering', level: 'Senior', loc: 'Remote · Global' },
  { slug: 'senior-data-analyst', title: 'Senior Data Analyst', dept: 'Data', level: 'Senior', loc: 'Remote · Global' },
  { slug: 'devops-lead', title: 'DevOps Lead', dept: 'Platform', level: 'Lead', loc: 'Remote · Global' },
  { slug: 'qa-engineer', title: 'QA Automation Engineer', dept: 'Quality', level: 'Senior', loc: 'Remote · Global' },
  { slug: 'product-manager', title: 'Senior Product Manager', dept: 'Product', level: 'Senior', loc: 'Remote · Global' },
];

export default function CareersPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-7xl px-6 pt-16 pb-24">
        <div className="text-center">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            <span className="text-gradient">Open roles at IPHIPI</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Six handpicked roles for the demo. Upload your resume on the{' '}
            <Link href="/match-me" className="text-foreground underline-offset-4 hover:underline">
              match-me page
            </Link>{' '}
            to see which fit you best.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => (
            <Link key={r.slug} href={`/careers/${r.slug}`} className="glass group p-6 transition hover:bg-white/[0.05]">
              <div className="text-xs uppercase tracking-wider text-brand-300">
                {r.dept} · {r.level}
              </div>
              <div className="mt-2 text-lg font-semibold text-foreground">
                {r.title}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{r.loc}</div>
              <div className="mt-6 inline-flex items-center gap-2 text-sm text-brand-300 transition group-hover:gap-3">
                View role <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
