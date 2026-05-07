/**
 * ApplyForm — client-side resume upload form.
 *
 * UX states:
 *   - idle:      file picker, optional name/email, submit
 *   - submitting: rich progress UI (uploading → parsing → scoring)
 *   - success:   redirect to /candidate/[id]
 *   - error:     friendly message + retry
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Upload, FileText, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

type Props = {
  jobId: string;
  jobSlug: string;
  jobTitle: string;
};

type Status = 'idle' | 'uploading' | 'parsing' | 'scoring' | 'done' | 'error';

export function ApplyForm({ jobId, jobSlug, jobTitle }: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setError(null);
    setStatus('uploading');

    const fd = new FormData();
    fd.append('resume', file);
    fd.append('jobId', jobId);
    if (name) fd.append('name', name);
    if (email) fd.append('email', email);

    // Switch through the perceived-progress states while the request is inflight.
    // (Real endpoint does upload + parse + score in one shot; these labels just
    // give the user something honest-feeling to look at.)
    const stages: Status[] = ['parsing', 'scoring'];
    let stageIdx = 0;
    const stageTimer = setInterval(() => {
      if (stageIdx < stages.length) {
        setStatus(stages[stageIdx]);
        stageIdx++;
      }
    }, 4000);

    try {
      const r = await fetch('/api/apply', { method: 'POST', body: fd });
      clearInterval(stageTimer);
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.message || data.error || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as { applicationId: string };
      setStatus('done');
      router.push(`/candidate/${data.applicationId}`);
    } catch (err) {
      clearInterval(stageTimer);
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const busy = status === 'uploading' || status === 'parsing' || status === 'scoring';

  return (
    <form onSubmit={onSubmit} className="glass mt-10 p-8 space-y-6">
      {/* File picker */}
      <FilePicker file={file} setFile={setFile} disabled={busy} />

      {/* Optional name / email */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Name (optional)"
          value={name}
          onChange={setName}
          placeholder="Jane Doe"
          disabled={busy}
        />
        <Input
          label="Email (optional)"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="jane@example.com"
          disabled={busy}
        />
      </div>

      {/* Submit */}
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
              Submit application
            </>
          )}
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          PDF only · Up to ~10MB · We use it only to score this application and prep your interview.
        </p>
      </div>

      {/* Inline status / errors */}
      {busy && <ProgressTrail status={status} jobTitle={jobTitle} />}
      {status === 'error' && error && <ErrorBox message={error} />}
      {status === 'done' && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          Submitted — redirecting to your fit score…
        </div>
      )}
    </form>
  );
}

/* ---------------------------------------------------------------- File picker */

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

/* ---------------------------------------------------------------- Input */

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 block h-11 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-brand-400/50 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
      />
    </label>
  );
}

/* ---------------------------------------------------------------- Progress trail */

function ProgressTrail({ status, jobTitle }: { status: Status; jobTitle: string }) {
  const stages: { id: Status; label: string }[] = [
    { id: 'uploading', label: 'Uploading resume' },
    { id: 'parsing', label: 'Reading resume (Agent 1)' },
    { id: 'scoring', label: `Scoring fit for ${jobTitle}` },
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
    case 'scoring': return 'Scoring fit';
    default: return 'Submitting';
  }
}
