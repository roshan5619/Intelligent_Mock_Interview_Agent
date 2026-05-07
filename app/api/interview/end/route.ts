/**
 * POST /api/interview/end
 *
 * Body: { sessionId: string }
 * Returns: { reportId, sessionId }
 *
 * Flow:
 *   1. Auth
 *   2. Mark session 'completed'
 *   3. Run Agent 6 (Feedback & Coaching) over full transcript + evaluations
 *   4. Persist report
 *   5. Return reportId — UI redirects to /interview/[sessionId]/report
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  CANDIDATE_COOKIE_NAME,
  verifyCandidateToken,
} from '@/lib/auth/candidate-token';
import {
  getApplication,
  getInterviewSession,
  getJob,
  listEvaluations,
  listTurns,
  saveReport,
  setApplicationStatus,
  setInterviewStatus,
} from '@/lib/storage/db';
import { generateReport } from '@/lib/agents/feedback-coaching';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { sessionId } = (await req.json()) as { sessionId?: string };
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    // 1. Auth + load
    const cookieStore = await cookies();
    const candidateId = verifyCandidateToken(
      cookieStore.get(CANDIDATE_COOKIE_NAME)?.value
    );
    if (!candidateId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const session = await getInterviewSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
    }
    const application = await getApplication(session.applicationId);
    if (!application || application.candidateId !== candidateId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (!application.contextProfile || !application.jobId) {
      return NextResponse.json({ error: 'invalid_session_state' }, { status: 400 });
    }
    const job = await getJob(application.jobId);
    if (!job) {
      return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
    }

    // 2. Mark session completed
    await setInterviewStatus(sessionId, 'completed');
    await setApplicationStatus(application.id, 'completed');

    // 3. Generate the report (Agent 6)
    const turns = await listTurns(sessionId);
    const evaluations = await listEvaluations(sessionId);
    const draft = await generateReport({
      sessionId,
      job,
      profile: application.contextProfile,
      turns,
      evaluations,
    });

    // 4. Persist
    const saved = await saveReport(draft);

    return NextResponse.json({
      reportId: saved.id,
      sessionId,
    });
  } catch (err) {
    console.error('[api/interview/end] failed:', err);
    return NextResponse.json(
      {
        error: 'end_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
