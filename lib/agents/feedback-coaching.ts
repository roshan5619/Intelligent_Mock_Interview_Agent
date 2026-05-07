/**
 * Agent 6 — Feedback & Coaching
 *
 * Runs ONCE at the end of the interview. Aggregates everything we know:
 *   - Full transcript
 *   - All per-turn AgentEvaluation rows (audio, visual, technical)
 *   - The candidate's ContextProfile + the target Job
 *
 * Produces the final Report (per-dimension scores + narrative coaching).
 */
import { z } from 'zod';
import * as llm from '@/lib/llm/client';
import { feedbackCoachingPrompt } from '@/lib/prompts';
import { AGENT_CONFIG } from '@/lib/llm/config';
import type {
  AgentEvaluation,
  ContextProfile,
  InterviewTurn,
  Job,
  Report,
  ReportScores,
} from '@/lib/storage/types';

const ReportPayloadSchema = z.object({
  summary_md: z.string(),
  scores: z.object({
    technical: z.number().min(0).max(100),
    communication: z.number().min(0).max(100),
    confidence: z.number().min(0).max(100),
    engagement: z.number().min(0).max(100),
    overall: z.number().min(0).max(100),
  }),
  strengths_md: z.string(),
  improvements_md: z.string(),
  behavioral_insights_md: z.string(),
  next_steps_md: z.string(),
});

type ReportPayload = z.infer<typeof ReportPayloadSchema>;

export type FeedbackInput = {
  sessionId: string;
  job: Job;
  profile: ContextProfile;
  turns: InterviewTurn[];
  evaluations: AgentEvaluation[];
};

export async function generateReport(
  input: FeedbackInput
): Promise<Omit<Report, 'id'>> {
  const aggregates = aggregateMetrics(input.evaluations, input.turns);
  const transcript = formatTranscript(input.turns);

  const cfg = AGENT_CONFIG['feedback-coaching'];
  const result = await llm.generate({
    preferProvider: cfg.preferProvider,
    options: cfg.options,
    messages: [
      { role: 'system', content: feedbackCoachingPrompt() },
      {
        role: 'user',
        content: [
          `TARGET ROLE: ${input.job.title} (${input.job.level}, ${input.job.department})`,
          `CANDIDATE PROFILE: ${JSON.stringify(abbreviateProfile(input.profile))}`,
          '',
          'TRANSCRIPT:',
          transcript,
          '',
          'PER-DIMENSION AGGREGATES:',
          JSON.stringify(aggregates, null, 2),
          '',
          'PER-TURN EVALUATIONS (top moments):',
          JSON.stringify(topMoments(input.evaluations).slice(0, 12), null, 2),
          '',
          'Generate the final report. Output JSON only.',
        ].join('\n'),
      },
    ],
  });

  const cleaned = result.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const parsed = ReportPayloadSchema.parse(JSON.parse(cleaned)) as ReportPayload;

  // Recompute overall to ensure consistency with the formula in the prompt.
  const overall =
    0.35 * parsed.scores.technical +
    0.30 * parsed.scores.communication +
    0.20 * parsed.scores.confidence +
    0.15 * parsed.scores.engagement;

  const scores: ReportScores = {
    ...parsed.scores,
    overall: Math.round(overall),
  };

  return {
    sessionId: input.sessionId,
    summaryMd: parsed.summary_md,
    scores,
    strengthsMd: parsed.strengths_md,
    improvementsMd: parsed.improvements_md,
    behavioralInsightsMd: parsed.behavioral_insights_md,
    nextStepsMd: parsed.next_steps_md,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

/* ------------------------------------------------------------------ helpers */

function aggregateMetrics(
  evals: AgentEvaluation[],
  turns: InterviewTurn[]
) {
  const byDim: Record<string, number[]> = {};
  for (const e of evals) {
    (byDim[e.dimension] ??= []).push(e.score);
  }
  const avg = (arr: number[] | undefined) =>
    !arr || arr.length === 0
      ? 0
      : Math.round((arr.reduce((s, n) => s + n, 0) / arr.length) * 100) / 100;

  // Find the question stems where confidence dipped or stress peaked.
  const byTurn: Record<string, { confidence?: number; stress?: number }> = {};
  for (const e of evals) {
    if (!e.turnId) continue;
    const slot = (byTurn[e.turnId] ??= {});
    if (e.dimension === 'confidence') slot.confidence = e.score;
    if (e.dimension === 'stress') slot.stress = e.score;
  }
  const turnById: Record<string, InterviewTurn> = {};
  for (const t of turns) turnById[t.id] = t;

  const lowConfidenceMoments: string[] = [];
  const stressPeaks: string[] = [];
  for (const [tid, slot] of Object.entries(byTurn)) {
    if (slot.confidence !== undefined && slot.confidence < 0.4) {
      const t = turnById[tid];
      if (t) lowConfidenceMoments.push(stem(t.content));
    }
    if (slot.stress !== undefined && slot.stress > 0.7) {
      const t = turnById[tid];
      if (t) stressPeaks.push(stem(t.content));
    }
  }

  return {
    technical: {
      correctness_avg: avg(byDim.correctness),
      depth_avg: avg(byDim.depth),
      specificity_avg: avg(byDim.specificity),
      concept_coverage_avg: avg(byDim.concept_coverage),
    },
    communication: {
      clarity_avg: avg(byDim.clarity),
    },
    confidence: {
      confidence_avg: avg(byDim.confidence),
      confidence_low_moments: lowConfidenceMoments.slice(0, 3),
    },
    engagement: {
      engagement_avg: avg(byDim.engagement),
      eye_contact_avg: avg(byDim.eye_contact),
      posture_avg: avg(byDim.posture),
    },
    stress: {
      stress_avg: avg(byDim.stress),
      stress_peaks: stressPeaks.slice(0, 3),
    },
  };
}

function topMoments(evals: AgentEvaluation[]) {
  // Most extreme scores (very high or very low) — these are the ones the
  // coach should reference in the report.
  return [...evals]
    .sort((a, b) => Math.abs(b.score - 0.5) - Math.abs(a.score - 0.5))
    .map((e) => ({
      turnId: e.turnId,
      dimension: e.dimension,
      score: e.score,
      evidence: e.evidence,
    }));
}

function formatTranscript(turns: InterviewTurn[]): string {
  return turns
    .map(
      (t) => `[turn ${t.turnIndex}] ${t.speaker === 'agent' ? 'Interviewer' : 'Candidate'}: ${t.content}`
    )
    .join('\n');
}

function abbreviateProfile(p: ContextProfile) {
  return {
    skills: p.skills.slice(0, 12),
    years_total: p.years_total,
    roles: p.roles.slice(0, 4),
    seniority_signals: p.seniority_signals.slice(0, 4),
  };
}

function stem(text: string): string {
  return text.length > 80 ? text.slice(0, 77) + '…' : text;
}
