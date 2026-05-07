/**
 * StartInterviewButton — client-side button on the candidate page.
 * POSTs to /api/interview/start, routes to /interview/[sessionId].
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowRight, Loader2 } from 'lucide-react';

export function StartInterviewButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/interview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.message || data.error || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as { sessionId: string };
      router.push(`/interview/${data.sessionId}`);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <Button size="lg" className="gap-2" onClick={start} disabled={busy}>
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing your interview…
          </>
        ) : (
          <>
            Start mock interview <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
      {error && (
        <p className="text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
