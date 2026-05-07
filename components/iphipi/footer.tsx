/**
 * Footer — minimal, brand-only. Lives below all marketing pages.
 */
export function Footer() {
  return (
    <footer className="hairline mt-32 py-12 text-center text-sm text-muted-foreground">
      <div className="mx-auto max-w-7xl px-6">
        <p>
          © {new Date().getFullYear()} IPHIPI · Agentic AI Mock Interview Platform
        </p>
        <p className="mt-2 text-xs opacity-70">
          Built with Next.js, Groq, Gemini, MediaPipe & a great deal of care.
        </p>
      </div>
    </footer>
  );
}
