/**
 * POST /api/apply
 *
 * Body: multipart/form-data with:
 *   - resume: File (PDF)
 *   - jobId:  string (optional — present when applying to a specific role)
 *   - name:   string (optional)
 *   - email:  string (optional)
 *
 * Returns: { applicationId, candidateId } on success.
 *
 * The Vercel function runs in Node runtime (NOT edge — pdf-parse + larger
 * deps need it). Set generous timeout so resume parsing has time to finish.
 */
import { NextResponse } from 'next/server';
import { processApplication } from '@/lib/actions/apply';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('resume');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'resume file missing' },
        { status: 400 }
      );
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json(
        { error: 'resume must be a PDF' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfBytes = Buffer.from(arrayBuffer);

    const jobIdRaw = form.get('jobId');
    const nameRaw = form.get('name');
    const emailRaw = form.get('email');

    const result = await processApplication({
      pdfBytes,
      filename: file.name,
      jobId: typeof jobIdRaw === 'string' && jobIdRaw ? jobIdRaw : undefined,
      name: typeof nameRaw === 'string' && nameRaw ? nameRaw : undefined,
      email: typeof emailRaw === 'string' && emailRaw ? emailRaw : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/apply] failed:', err);
    return NextResponse.json(
      {
        error: 'apply_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
