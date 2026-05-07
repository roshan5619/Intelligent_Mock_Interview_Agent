/**
 * POST /api/interview/turn
 *
 * Body:
 *   {
 *     sessionId: string,
 *     candidateText: string,
 *     audioMetrics?: AudioMetrics,
 *     visualMetrics?: VisualMetrics,
 *   }
 *
 * Pipeline (per turn):
 *   1. Auth (cookie owns the session's application)
 *   2. Persist the candidate turn (with audio + visual metrics)
 *   3. PARALLEL:
 *        a) Score audio (Agent 3, LLM)
 *        b) Score visual (Agent 4, deterministic — fast)
 *        c) Score technical (Agent 5, LLM) — needs the previous interviewer turn
 *   4. Persist all per-dimension AgentEvaluation rows
 *   5. Compute trends + run orchestrator (Agent 2) for next interviewer turn
 *   6. Persist the new interviewer turn
 *   7. Return the next question + the latest evaluations + remaining time
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  CANDIDATE_COOKIE_NAME,
  verifyCandidateToken,
} from '@/lib/auth/candidate-token';
import {
  appendEvaluation,
  appendTurn,
  getApplication,
  getInterviewSession,
  getJob,
  listEvaluations,
  listTurns,
} from '@/lib/storage/db';
import { decideNextTurn } from '@/lib/agents/orchestrator';
import { scoreAudio } from '@/lib/agents/audio-intelligence';
import { scoreVisual } from '@/lib/agents/visual-intelligence';
import { scoreAnswer } from '@/lib/agents/technical-evaluation';
import type { AudioMetrics, VisualMetrics } from '@/lib/storage/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TOTAL_BUDGET_MINUTES = 12;

type Body = {
  sessionId: string;
  candidateText: string;
  audioMetrics?: AudioMetrics;
  visualMetrics?: VisualMetrics;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }
    const candidateText = (body.candidateText ?? '').trim();

    // 1. Auth + load
    const cookieStore = await cookies();
    const candidateId = verifyCandidateToken(
      cookieStore.get(CANDIDATE_COOKIE_NAME)?.value
    );
    if (!candidateId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const session = await getInterviewSession(body.sessionId);
    if (!session) {
      return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
    }
    const application = await getApplication(session.applicationId);
    if (!application || application.candidateId !== candidateId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (!application.contextProfile || !application.jobId) {
      return NextResponse.json(
        { error: 'invalid_session_state' },
        { status: 400 }
      );
    }
    const job = await getJob(application.jobId);
    if (!job) {
      return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
    }

    // 2. Persist candidate turn
    const allTurns = await listTurns(session.id);
    const previousAgentTurn = [...allTurns]
      .reverse()
      .find((t) => t.speaker === 'agent');

    const candidateTurnIndex = allTurns.length;
    const candidateTurn = await appendTurn({
      sessionId: session.id,
      turnIndex: candidateTurnIndex,
      speaker: 'candidate',
      content: candidateText,
      audioMetrics: body.audioMetrics ?? null,
      visualMetrics: body.visualMetrics ?? null,
    });

    // 3. Parallel scoring
    const [audioResult, technicalResult] = await Promise.all([
      body.audioMetrics
        ? scoreAudio({
            transcript: candidateText,
            metrics: body.audioMetrics,
          }).catch((err) => {
            console.warn('[turn] audio scoring failed:', err);
            return null;
          })
        : Promise.resolve(null),

      previousAgentTurn
        ? scoreAnswer({
            question: previousAgentTurn.content,
            focusArea: previousAgentTurn.agentIntent ?? 'general',
            expectedConcepts: [], // orchestrator may inject these later
            candidateProfile: application.contextProfile,
            candidateAnswer: candidateText,
          }).catch((err) => {
            console.warn('[turn] technical scoring failed:', err);
            return null;
          })
        : Promise.resolve(null),
    ]);

    const visualResult = body.visualMetrics ? scoreVisual(body.visualMetrics) : null;

    // 4. Persist evaluations
    if (audioResult) {
      await Promise.all([
        appendEvaluation({
          sessionId: session.id,
          turnId: candidateTurn.id,
          agentKey: 'audio',
          dimension: 'confidence',
          score: audioResult.confidence,
          evidence: { quote: audioResult.evidence, summary: audioResult.signals_summary },
        }),
        appendEvaluation({
          sessionId: session.id,
          turnId: candidateTurn.id,
          agentKey: 'audio',
          dimension: 'clarity',
          score: audioResult.clarity,
          evidence: { quote: audioResult.evidence },
        }),
      ]);
    }
    if (visualResult) {
      await Promise.all([
        appendEvaluation({
          sessionId: session.id,
          turnId: candidateTurn.id,
          agentKey: 'visual',
          dimension: 'engagement',
          score: visualResult.engagement_score,
          evidence: { summary: visualResult.signals_summary },
        }),
        appendEvaluation({
          sessionId: session.id,
          turnId: candidateTurn.id,
          agentKey: 'visual',
          dimension: 'stress',
          score: visualResult.stress_indicator,
          evidence: { summary: visualResult.signals_summary },
        }),
        appendEvaluation({
          sessionId: session.id,
          turnId: candidateTurn.id,
          agentKey: 'visual',
          dimension: 'eye_contact',
          score: visualResult.eye_contact_ratio,
          evidence: null,
        }),
        appendEvaluation({
          sessionId: session.id,
          turnId: candidateTurn.id,
          agentKey: 'visual',
          dimension: 'posture',
          score: visualResult.posture_score,
          evidence: null,
        }),
      ]);
    }
    if (technicalResult) {
      await Promise.all([
        appendEvaluation({
          sessionId: session.id,
          turnId: candidateTurn.id,
          agentKey: 'technical',
          dimension: 'correctness',
          score: technicalResult.correctness,
          evidence: { quote: technicalResult.evidence_quote, flags: technicalResult.flags },
        }),
        appendEvaluation({
          sessionId: session.id,
          turnId: candidateTurn.id,
          agentKey: 'technical',
          dimension: 'depth',
          score: technicalResult.depth,
          evidence: { quote: technicalResult.evidence_quote },
        }),
        appendEvaluation({
          sessionId: session.id,
          turnId: candidateTurn.id,
          agentKey: 'technical',
          dimension: 'specificity',
          score: technicalResult.specificity,
          evidence: { quote: technicalResult.evidence_quote },
        }),
        appendEvaluation({
          sessionId: session.id,
          turnId: candidateTurn.id,
          agentKey: 'technical',
          dimension: 'concept_coverage',
          score: technicalResult.concept_coverage,
          evidence: null,
        }),
      ]);
    }

    // 5. Build trends + decide next turn
    const allEvals = await listEvaluations(session.id);
    const confidenceTrend = trendOf(allEvals, 'confidence');
    const correctnessTrend = trendOf(allEvals, 'correctness');

    const elapsedMinutes = (Date.now() / 1000 - session.startedAt) / 60;
    const timeBudgetMinutes = Math.max(0, TOTAL_BUDGET_MINUTES - elapsedMinutes);

    const updatedTurns = await listTurns(session.id);

    const decision = await decideNextTurn({
      job,
      profile: application.contextProfile,
      agenda: session.agenda,
      recentTurns: updatedTurns,
      latestMetrics: {
        audio: audioResult
          ? { confidence: audioResult.confidence, clarity: audioResult.clarity }
          : undefined,
        visual: visualResult
          ? {
              engagement: visualResult.engagement_score,
              eye_contact_ratio: visualResult.eye_contact_ratio,
              stress_indicator: visualResult.stress_indicator,
            }
          : undefined,
        technical: technicalResult
          ? {
              correctness: technicalResult.correctness,
              depth: technicalResult.depth,
              concept_coverage: technicalResult.concept_coverage,
            }
          : undefined,
      },
      confidenceTrend,
      correctnessTrend,
      timeBudgetMinutes,
    });

    // 6. Persist next interviewer turn
    const agentTurn = await appendTurn({
      sessionId: session.id,
      turnIndex: candidateTurnIndex + 1,
      speaker: 'agent',
      content: decision.next_question,
      agentIntent: decision.intent,
      difficulty: decision.difficulty,
    });

    // 7. Return everything the UI needs to render the next turn
    return NextResponse.json({
      agentTurn: {
        id: agentTurn.id,
        content: decision.next_question,
        intent: decision.intent,
        focusArea: decision.target_focus_area,
        difficulty: decision.difficulty,
        questionStyle: decision.question_style,
      },
      latestScores: {
        audio: audioResult,
        visual: visualResult,
        technical: technicalResult,
      },
      timeBudgetMinutes: round1(timeBudgetMinutes),
      isWrapUp: decision.intent === 'wrap_up',
    });
  } catch (err) {
    console.error('[api/interview/turn] failed:', err);
    return NextResponse.json(
      {
        error: 'turn_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

/* ------------------------------------------------------------------ helpers */

function trendOf(
  evals: Awaited<ReturnType<typeof listEvaluations>>,
  dimension: string
): number[] {
  return evals
    .filter((e) => e.dimension === dimension)
    .map((e) => e.score);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
