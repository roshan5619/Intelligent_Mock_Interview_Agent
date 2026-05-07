/**
 * MatchMeForm — client form that uploads a resume and redirects to the
 * results page (which renders the ranked roles).
 *
 * Reuses the FilePicker/Input/ProgressTrail patterns from ApplyForm but
 * targets /api/match/rank-all instead of /api/apply.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Upload,
  FileText,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

type Status = 'idle' | 'uploading' | 'parsing' | 'ranking' | 'done' | 'error';

export function MatchMeForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setError(null);
    setStatus('uploading');

    const fd = new FormData();
    fd.append('resume', file);

    // Perceived-progress staging — the request is one shot.
    const stages: Status[] = ['parsing', 'ranking'];
    let stageIdx = 0;
    const stageTimer = setInterval(() => {
      if (stageIdx < stages.length) {
        setStatus(stages[stageIdx]);
        stageIdx++;
      }
    }, 5000);

    try {
      const r = await fetch('/api/match/rank-all', { method: 'POST', body: fd });
      clearInterval(stageTimer);
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.message || data.error || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as { runId: string };
      setStatus('done');
      router.push(`/match-me/results/${data.runId}`);
    } catch (err) {
      clearInterval(stageTimer);
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const busy = status === 'uploading' || status === 'parsing' || status === 'ranking';

  return (
    <form onSubmit={onSubmit} className="glass mt-10 p-8 space-y-6">
      <FilePicker file={file} setFile={setFile} disabled={busy} />

      <div className="pt-2">
        <Button type="submit" size="lg" disabled={!file || busy} className="w-full sm:w-auto">
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {statusLabel(status)}…
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Rank IPHIPI roles for me
            </>
          )}
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          PDF only · Up to ~10MB · Used only for this scoring + your interview.
        </p>
      </div>

      {busy && <ProgressTrail status={status} />}
      {status === 'error' && error && <ErrorBox message={error} />}
      {status === 'done' && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> Ranking complete — redirecting…
        </div>
      )}
    </form>
  );
}

function FilePicker({
  file,
  setFile,
  disabled,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  disabled: boolean;
}) {
  return (
    <label
      className={
        'group flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center transition hover:border-brand-400/40 hover:bg-white/[0.04] ' +
        (disabled ? 'pointer-events-none opacity-60' : '')
      }
    >
      {file ? (
        <>
          <FileText className="h-8 w-8 text-brand-300" />
          <div className="mt-3 text-sm font-medium text-foreground">{file.name}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {(file.size / 1024).toFixed(0)} KB · Click to choose a different file
          </div>
        </>
      ) : (
        <>
          <Upload className="h-8 w-8 text-muted-foreground transition group-hover:text-brand-300" />
          <div className="mt-3 text-sm font-medium text-foreground">
            Click to upload your resume
          </div>
          <div className="mt-1 text-xs text-muted-foreground">PDF, up to ~10MB</div>
        </>
      )}
      <input
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        disabled={disabled}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

function ProgressTrail({ status }: { status: Status }) {
  const stages: { id: Status; label: string }[] = [
    { id: 'uploading', label: 'Uploading resume' },
    { id: 'parsing', label: 'Reading resume (Agent 1)' },
    { id: 'ranking', label: 'Scoring fit for every IPHIPI role' },
  ];
  const activeIdx = stages.findIndex((s) => s.id === status);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <ul className="space-y-2 text-sm">
        {stages.map((s, idx) => {
          const done = idx < activeIdx;
          const active = idx === activeIdx;
          return (
            <li
              key={s.id}
              className={
                done
                  ? 'flex items-center gap-2 text-emerald-300'
                  : active
                  ? 'flex items-center gap-2 text-foreground'
                  : 'flex items-center gap-2 text-muted-foreground'
              }
            >
              {done ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : active ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="block h-2 w-2 rounded-full bg-white/15" />
              )}
              {s.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-500/5 p-3 text-sm text-red-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div>
        <div className="font-medium">Something went wrong</div>
        <div className="mt-1 text-xs opacity-80">{message}</div>
      </div>
    </div>
  );
}

function statusLabel(s: Status): string {
  switch (s) {
    case 'uploading': return 'Uploading';
    case 'parsing': return 'Reading resume';
    case 'ranking': return 'Ranking roles';
    default: return 'Working';
  }
}
