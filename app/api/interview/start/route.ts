/**
 * POST /api/interview/start
 *
 * Body: { applicationId: string }
 * Returns:
 *   {
 *     sessionId: string,
 *     agenda: AgendaItem[],
 *     firstTurn: { content, intent, focusArea, difficulty },
 *     job: { title, level, department }
 *   }
 *
 * Pipeline:
 *   1. Verify candidate cookie owns the application
 *   2. Load application + job + ContextProfile
 *   3. Build the agenda (heuristic — see lib/agents/agenda.ts)
 *   4. Create the interview_sessions row
 *   5. Run the orchestrator with empty history → first interviewer turn
 *   6. Persist that opening turn
 *   7. Return everything the UI needs to render the interview shell
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  CANDIDATE_COOKIE_NAME,
  verifyCandidateToken,
} from '@/lib/auth/candidate-token';
import {
  appendTurn,
  createInterviewSession,
  getApplication,
  getJob,
  setApplicationStatus,
} from '@/lib/storage/db';
import { buildAgenda } from '@/lib/agents/agenda';
import { decideNextTurn } from '@/lib/agents/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TOTAL_BUDGET_MINUTES = 12;

export async function POST(req: Request) {
  try {
    const { applicationId } = (await req.json()) as { applicationId?: string };
    if (!applicationId) {
      return NextResponse.json({ error: 'applicationId required' }, { status: 400 });
    }

    // 1. Auth
    const cookieStore = await cookies();
    const candidateId = verifyCandidateToken(
      cookieStore.get(CANDIDATE_COOKIE_NAME)?.value
    );
    if (!candidateId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // 2. Load
    const application = await getApplication(applicationId);
    if (!application || application.candidateId !== candidateId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (!application.contextProfile) {
      return NextResponse.json(
        { error: 'context_profile_missing — resume parse not complete' },
        { status: 400 }
      );
    }
    if (!application.jobId) {
      return NextResponse.json(
        { error: 'no_job — apply via /apply/[slug] before interviewing' },
        { status: 400 }
      );
    }
    const job = await getJob(application.jobId);
    if (!job) {
      return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
    }

    // 3. Agenda
    const agenda = buildAgenda(application.contextProfile, job);

    // 4. Create session
    const session = await createInterviewSession({
      applicationId,
      targetRole: job.title,
      agenda,
    });
    await setApplicationStatus(applicationId, 'interviewing');

    // 5. Orchestrator: opening turn (no history yet)
    const decision = await decideNextTurn({
      job,
      profile: application.contextProfile,
      agenda,
      recentTurns: [],
      latestMetrics: {},
      confidenceTrend: [],
      correctnessTrend: [],
      timeBudgetMinutes: TOTAL_BUDGET_MINUTES,
    });

    // 6. Persist opening turn
    await appendTurn({
      sessionId: session.id,
      turnIndex: 0,
      speaker: 'agent',
      content: decision.next_question,
      agentIntent: decision.intent,
      difficulty: decision.difficulty,
    });

    return NextResponse.json({
      sessionId: session.id,
      agenda,
      firstTurn: {
        content: decision.next_question,
        intent: decision.intent,
        focusArea: decision.target_focus_area,
        difficulty: decision.difficulty,
        questionStyle: decision.question_style,
      },
      job: {
        title: job.title,
        level: job.level,
        department: job.department,
      },
      totalBudgetMinutes: TOTAL_BUDGET_MINUTES,
    });
  } catch (err) {
    console.error('[api/interview/start] failed:', err);
    return NextResponse.json(
      {
        error: 'start_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
