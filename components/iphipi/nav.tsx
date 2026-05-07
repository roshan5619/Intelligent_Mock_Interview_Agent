/**
 * Top navigation bar shared across marketing pages.
 * Sticky, glass surface, auto-hides on scroll-down (subtle).
 */
import Link from 'next/link';
import { Sparkles } from 'lucide-react';

export function Nav() {
  return (
    <header className="sticky top-0 z-40 w-full">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mt-4 flex h-14 items-center justify-between rounded-2xl border border-white/10 bg-background/60 px-5 backdrop-blur-xl">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 shadow-lg shadow-brand-500/25">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-gradient text-lg tracking-tight">IPHIPI</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <Link href="/careers" className="transition hover:text-foreground">
              Careers
            </Link>
            <Link href="/match-me" className="transition hover:text-foreground">
              Match my resume
            </Link>
            <Link href="/#how" className="transition hover:text-foreground">
              How it works
            </Link>
          </nav>
          <Link
            href="/match-me"
            className="rounded-lg bg-white/[0.06] px-4 py-2 text-sm font-medium text-foreground transition hover:bg-white/[0.1]"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
