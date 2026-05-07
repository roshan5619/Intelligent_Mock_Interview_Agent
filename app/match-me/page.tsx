/**
 * /match-me — upload a resume and rank IPHIPI's open roles for the candidate.
 * The form posts to /api/match/rank-all and redirects to results.
 */
import { Nav } from '@/components/iphipi/nav';
import { Footer } from '@/components/iphipi/footer';
import { MatchMeForm } from '@/components/iphipi/match-me-form';
import { Compass } from 'lucide-react';

export default function MatchMePage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 pt-16 pb-24">
        <div className="text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs text-muted-foreground">
            <Compass className="h-3.5 w-3.5 text-brand-300" />
            Resume-driven role recommendations
          </div>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            <span className="text-gradient">Match my resume</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Upload your resume. We'll rank every open IPHIPI role for you,
            score the fit, and explain why each one fits — so you know exactly
            where to apply.
          </p>
        </div>

        <MatchMeForm />
      </main>
      <Footer />
    </>
  );
}
