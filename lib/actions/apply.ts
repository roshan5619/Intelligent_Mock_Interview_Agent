/**
 * Server action: handle a candidate's job application.
 *
 * Flow:
 *   1. Receive resume PDF + (optional) name/email + (optional) jobId
 *   2. Issue or reuse a candidate cookie (HMAC-signed)
 *   3. Save the resume to Vercel Blob (or local FS in dev)
 *   4. Create an `applications` row (status='parsing')
 *   5. Run Agent 1 (Context Understanding) on the PDF
 *   6. If a jobId was provided, score the match against that job
 *   7. Persist context profile + match breakdown; status='ready'
 *   8. Return { applicationId, candidateId }
 *
 * Caller (the form) is responsible for redirecting the user to
 * `/candidate/[applicationId]` after this resolves.
 *
 * NOTE: this is intentionally a *server module* (no 'use server' so it can be
 * imported by route handlers too). The `applyAction` export at the bottom is
 * the "use server" marker for direct form submission.
 */
import 'server-only';
import { cookies } from 'next/headers';
import {
  CANDIDATE_COOKIE_NAME,
  signCandidateToken,
  verifyCandidateToken,
} from '@/lib/auth/candidate-token';
import { uploadResume } from '@/lib/storage/blob';
import {
  createCandidate,
  createApplication,
  getJob,
  setApplicationStatus,
  updateApplicationContext,
  updateApplicationMatch,
} from '@/lib/storage/db';
import { parseResumePdf } from '@/lib/agents/context-understanding';
import { scoreMatch } from '@/lib/matching/jd-match';

export type ApplyInput = {
  pdfBytes: Buffer;
  filename: string;
  name?: string;
  email?: string;
  /** If provided, score the resume against this specific job. */
  jobId?: string;
};

export type ApplyResult = {
  applicationId: string;
  candidateId: string;
  /** True if we created a new candidate; false if we reused the cookie. */
  newCandidate: boolean;
};

export async function processApplication(input: ApplyInput): Promise<ApplyResult> {
  // 1. Identify the candidate (reuse cookie if present)
  const cookieStore = await cookies();
  const existing = cookieStore.get(CANDIDATE_COOKIE_NAME)?.value;
  const candidateIdFromCookie = verifyCandidateToken(existing);

  let candidateId: string;
  let newCandidate = false;
  if (candidateIdFromCookie) {
    candidateId = candidateIdFromCookie;
  } else {
    const c = await createCandidate({ email: input.email, name: input.name });
    candidateId = c.id;
    newCandidate = true;
    cookieStore.set(CANDIDATE_COOKIE_NAME, signCandidateToken(c.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }

  // 2. Save the resume
  const uploaded = await uploadResume(input.pdfBytes, input.filename);

  // 3. Create the application row
  const application = await createApplication({
    candidateId,
    jobId: input.jobId ?? null,
    resumeBlobUrl: uploaded.url,
    resumeFilename: uploaded.filename,
  });

  // 4. Run Agent 1 (Context Understanding) on the PDF
  const profile = await parseResumePdf(input.pdfBytes);
  await updateApplicationContext(application.id, profile);

  // 5. If targeting a specific job, score the match
  if (input.jobId) {
    const job = await getJob(input.jobId);
    if (job) {
      const breakdown = await scoreMatch(profile, job);
      await updateApplicationMatch(application.id, breakdown);
    } else {
      await setApplicationStatus(application.id, 'ready');
    }
  } else {
    await setApplicationStatus(application.id, 'ready');
  }

  return {
    applicationId: application.id,
    candidateId,
    newCandidate,
  };
}
