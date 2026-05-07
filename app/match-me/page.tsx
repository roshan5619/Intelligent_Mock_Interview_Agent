/**
 * /match-me — placeholder for the resume-driven role ranking page.
 * Will be wired to Agent 1 (Context Understanding) + JD Match in a later step.
 */
import { Nav } from '@/components/iphipi/nav';
import { Footer } from '@/components/iphipi/footer';
import { Upload, Wand2 } from 'lucide-react';

export default function MatchMePage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 pt-16 pb-24">
        <div className="text-center">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            <span className="text-gradient">Match my resume</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Upload your resume and we'll rank IPHIPI's open roles for you, with
            a fit score and "why this fits" reasoning per role.
          </p>
        </div>

        <div className="glass mt-12 p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/15 ring-1 ring-brand-400/20">
            <Upload className="h-5 w-5 text-brand-300" />
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Resume upload + role-ranking pipeline arriving next. Agent 1
            (Context Understanding) will read your PDF, infer target roles, and
            score every IPHIPI opening against your profile.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs text-muted-foreground">
            <Wand2 className="h-3.5 w-3.5 text-brand-300" />
            Coming online shortly · Powered by Groq Llama 3.3 70B + Gemini 2.0
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
