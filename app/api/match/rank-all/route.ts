/**
 * POST /api/match/rank-all
 *
 * Resume → ContextProfile (Agent 1) → rank every IPHIPI job → save run.
 *
 * Body: multipart/form-data with `resume` (PDF). Optional `name`, `email`.
 * Returns: { runId, applicationId, candidateId }
 */
import { NextResponse } from 'next/server';
import { processApplication } from '@/lib/actions/apply';
import { getApplication, saveRoleMatchRun } from '@/lib/storage/db';
import { rankAllJobs } from '@/lib/matching/rank-all';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('resume');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'resume file missing' }, { status: 400 });
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'resume must be a PDF' }, { status: 400 });
    }

    const pdfBytes = Buffer.from(await file.arrayBuffer());
    const nameRaw = form.get('name');
    const emailRaw = form.get('email');

    // 1. Run the standard apply pipeline WITHOUT a jobId — just want the
    // ContextProfile persisted onto an application row we can reuse.
    const applied = await processApplication({
      pdfBytes,
      filename: file.name,
      name: typeof nameRaw === 'string' && nameRaw ? nameRaw : undefined,
      email: typeof emailRaw === 'string' && emailRaw ? emailRaw : undefined,
    });

    // 2. Rank all jobs against the parsed profile.
    const application = await getApplication(applied.applicationId);
    if (!application?.contextProfile) {
      throw new Error('context profile missing after apply pipeline');
    }
    const results = await rankAllJobs(application.contextProfile);

    // 3. Persist the run.
    const run = await saveRoleMatchRun({
      candidateId: applied.candidateId,
      results,
    });

    return NextResponse.json({
      runId: run.id,
      applicationId: applied.applicationId,
      candidateId: applied.candidateId,
    });
  } catch (err) {
    console.error('[api/match/rank-all] failed:', err);
    return NextResponse.json(
      {
        error: 'rank_all_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
