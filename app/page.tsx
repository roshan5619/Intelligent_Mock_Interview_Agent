/**
 * IPHIPI landing page — the front door to the platform.
 * Three sections: hero, "how it works", and a final CTA strip.
 *
 * This is a server component — no client-side state needed here.
 */
import Link from 'next/link';
import {
  Sparkles,
  FileText,
  Compass,
  Mic,
  Eye,
  ClipboardCheck,
  ArrowRight,
} from 'lucide-react';
import { Nav } from '@/components/iphipi/nav';
import { Footer } from '@/components/iphipi/footer';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-7xl px-6">
        <Hero />
        <Pillars />
        <HowItWorks />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}

/* ---------------------------------------------------------------- Hero */

function Hero() {
  return (
    <section className="relative pt-24 pb-32 text-center sm:pt-32">
      {/* Background glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 30%, rgba(91,103,255,0.25), transparent 60%)',
        }}
      />

      <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs text-muted-foreground backdrop-blur-md">
        <Sparkles className="h-3.5 w-3.5 text-brand-300" />
        State-of-the-art agentic AI · Multimodal scoring · Built for senior roles
      </div>

      <h1 className="mx-auto mt-8 max-w-4xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl">
        <span className="text-gradient">Practice the interview</span>
        <br />
        <span className="text-foreground/90">that gets you the offer.</span>
      </h1>

      <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground sm:text-xl">
        Upload your resume. We infer the roles you can realistically land,
        then run a live multimodal mock interview that scores your{' '}
        <span className="text-foreground">technical depth</span>,{' '}
        <span className="text-foreground">communication</span>, and{' '}
        <span className="text-foreground">on-camera presence</span> — and
        coaches you on what to do next.
      </p>

      <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href="/match-me">
          <Button size="lg" className="gap-2">
            Match my resume to a role
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/careers">
          <Button size="lg" variant="secondary">
            Browse careers
          </Button>
        </Link>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Free during the hackathon · No signup required for the demo
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- Pillars */

const PILLARS = [
  {
    icon: FileText,
    title: 'Reads your resume',
    body: 'A context-understanding agent extracts skills, seniority signals, and project deep-dives — and infers the roles you can realistically target.',
  },
  {
    icon: Compass,
    title: 'Adapts to you',
    body: 'An orchestrator agent dynamically generates questions and ramps difficulty up or down based on your live performance.',
  },
  {
    icon: Mic,
    title: 'Hears confidence',
    body: 'Web Audio analytics measure pitch, hesitation, and pace — translated into a confidence and clarity score.',
  },
  {
    icon: Eye,
    title: 'Sees engagement',
    body: 'Pretrained vision models (MediaPipe) read eye contact, posture, and expression entirely on-device — your video never leaves your browser.',
  },
  {
    icon: ClipboardCheck,
    title: 'Scores rigorously',
    body: 'A technical evaluation engine grades correctness, depth, and specificity — with evidence quotes from your transcript.',
  },
  {
    icon: Sparkles,
    title: 'Coaches actionably',
    body: 'You walk away with specific, named improvements — not generic advice.',
  },
];

function Pillars() {
  return (
    <section className="py-12">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="glass p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/15 ring-1 ring-brand-400/20">
              <Icon className="h-5 w-5 text-brand-300" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-foreground">
              {title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- How it works */

const STEPS = [
  {
    n: '01',
    title: 'Upload your resume',
    body: 'PDF or text. Our agent infers your strongest target roles and generates a personalized interview agenda.',
  },
  {
    n: '02',
    title: 'See your fit score',
    body: 'Hybrid scoring (semantic + skill overlap + seniority) ranks every IPHIPI role for you, with explainable reasoning.',
  },
  {
    n: '03',
    title: 'Take the interview',
    body: 'Live, multi-agent, multimodal. Voice + camera. Adaptive difficulty. Six specialized agents working in concert.',
  },
  {
    n: '04',
    title: 'Get coached',
    body: 'Per-dimension scores, evidence quotes, behavioral insights, and the specific next steps that move the needle.',
  },
];

function HowItWorks() {
  return (
    <section id="how" className="py-24">
      <div className="text-center">
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Six agents. One natural conversation.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Behind the scenes, specialized AI agents observe, evaluate, and adapt
          — so you experience an interview, not a quiz.
        </p>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(({ n, title, body }) => (
          <div key={n} className="glass p-6">
            <div className="font-mono text-xs text-brand-300">{n}</div>
            <div className="mt-3 text-base font-semibold text-foreground">
              {title}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Final CTA */

function FinalCta() {
  return (
    <section className="py-12">
      <div className="glass-strong relative overflow-hidden p-10 text-center sm:p-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(ellipse 60% 60% at 50% 0%, rgba(139,92,246,0.18), transparent 60%)',
          }}
        />
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Ready to interview at your level?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Drop in your resume. Two minutes from now, you'll be in a real-feeling
          mock interview.
        </p>
        <div className="mt-8">
          <Link href="/match-me">
            <Button size="lg" className="gap-2">
              Match my resume
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
