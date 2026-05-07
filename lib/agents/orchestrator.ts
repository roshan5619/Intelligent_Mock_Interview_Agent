/**
 * Agent 2 — Interview Orchestrator
 *
 * Decides the interviewer's next turn given:
 *   - candidate context profile
 *   - target role
 *   - agenda (with progress markers)
 *   - recent transcript turns
 *   - latest multimodal metrics
 *
 * Returns a typed OrchestratorDecision the API route streams back to the UI.
 *
 * Adaptive heuristics layered on top of the LLM:
 *   - 2x consecutive low confidence → force `drop_difficulty` + encouragement
 *   - 2x consecutive high correctness → force `ramp_difficulty`
 *   - Time budget < 2min → force `wrap_up`
 */
import { z } from 'zod';
import * as llm from '@/lib/llm/client';
import { orchestratorPrompt } from '@/lib/prompts';
import { AGENT_CONFIG } from '@/lib/llm/config';
import type {
  AgendaItem,
  ContextProfile,
  InterviewTurn,
  Job,
} from '@/lib/storage/types';

/* ------------------------------------------------------------------ types */

export type OrchestratorDecision = {
  intent:
    | 'probe_deeper'
    | 'switch_topic'
    | 'drop_difficulty'
    | 'ramp_difficulty'
    | 'clarify'
    | 'encourage'
    | 'wrap_up';
  target_focus_area: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  question_style:
    | 'open_ended'
    | 'scenario'
    | 'system_design'
    | 'behavioral_star'
    | 'trivia';
  next_question: string;
};

const DecisionSchema = z.object({
  intent: z.enum([
    'probe_deeper',
    'switch_topic',
    'drop_difficulty',
    'ramp_difficulty',
    'clarify',
    'encourage',
    'wrap_up',
  ]),
  target_focus_area: z.string(),
  difficulty: z.number().int().min(1).max(5),
  question_style: z.enum([
    'open_ended',
    'scenario',
    'system_design',
    'behavioral_star',
    'trivia',
  ]),
  next_question: z.string(),
});

/** Per-turn metric snapshot the orchestrator sees. */
export type RecentMetrics = {
  audio?: { confidence: number; clarity: number };
  visual?: { engagement: number; eye_contact_ratio: number; stress_indicator: number };
  technical?: { correctness: number; depth: number; concept_coverage: number };
};

export type OrchestratorInput = {
  job: Job;
  profile: ContextProfile;
  agenda: AgendaItem[];
  /** turns ordered oldest → newest, INCLUDING the latest candidate utterance */
  recentTurns: InterviewTurn[];
  latestMetrics: RecentMetrics;
  /** Same dimension across the last few turns (newest last). */
  confidenceTrend: number[];
  correctnessTrend: number[];
  timeBudgetMinutes: number;
};

/* ------------------------------------------------------------------ entry */

export async function decideNextTurn(
  input: OrchestratorInput
): Promise<OrchestratorDecision> {
  const userMsg = buildUserMessage(input);
  const cfg = AGENT_CONFIG.orchestrator;
  const result = await llm.generate({
    preferProvider: cfg.preferProvider,
    options: { ...cfg.options, json: true },
    messages: [
      { role: 'system', content: orchestratorPrompt() },
      { role: 'user', content: userMsg },
    ],
  });

  const decision = parseDecision(result.text);

  // Apply hard heuristics that override the LLM if needed.
  return applyHeuristics(decision, input);
}

/* ------------------------------------------------------------------ helpers */

function buildUserMessage(input: OrchestratorInput): string {
  const profileBrief = abbreviateProfile(input.profile);
  const remaining = input.agenda
    .map((a, i) => `${i + 1}. [${a.focusArea}] ${a.topic}`)
    .join('\n');

  // Last 6 turns, oldest → newest
  const lastTurns = input.recentTurns
    .slice(-6)
    .map(
      (t) => `${t.speaker === 'agent' ? 'Interviewer' : 'Candidate'}: ${t.content}`
    )
    .join('\n');

  const m = input.latestMetrics;

  return [
    `CANDIDATE PROFILE: ${JSON.stringify(profileBrief)}`,
    `TARGET ROLE: ${input.job.title} (${input.job.level}, ${input.job.department})`,
    `KEY REQUIREMENTS: ${input.job.jdStruct.must_haves.join(', ')}`,
    `AGENDA REMAINING:\n${remaining || '(none)'}`,
    `TURN HISTORY (last 6):\n${lastTurns || '(this is the opening turn)'}`,
    'LATEST METRICS:',
    `  audio: ${m.audio ? `confidence=${m.audio.confidence.toFixed(2)}, clarity=${m.audio.clarity.toFixed(2)}` : 'n/a'}`,
    `  visual: ${m.visual ? `engagement=${m.visual.engagement.toFixed(2)}, eye_contact=${m.visual.eye_contact_ratio.toFixed(2)}, stress=${m.visual.stress_indicator.toFixed(2)}` : 'n/a'}`,
    `  technical: ${m.technical ? `correctness=${m.technical.correctness.toFixed(2)}, depth=${m.technical.depth.toFixed(2)}, concept_coverage=${m.technical.concept_coverage.toFixed(2)}` : 'n/a'}`,
    `CONFIDENCE TREND: [${input.confidenceTrend.map((n) => n.toFixed(2)).join(', ')}]`,
    `CORRECTNESS TREND: [${input.correctnessTrend.map((n) => n.toFixed(2)).join(', ')}]`,
    `TIME BUDGET: ${input.timeBudgetMinutes.toFixed(1)} minutes remaining`,
    '',
    'Decide the next turn. Output ONLY the JSON object.',
  ].join('\n');
}

function abbreviateProfile(p: ContextProfile) {
  return {
    skills: p.skills.slice(0, 20),
    years_total: p.years_total,
    roles: p.roles.slice(0, 5),
    projects: p.projects.slice(0, 4).map((pr) => ({
      name: pr.name,
      summary: pr.summary,
      tech: pr.tech?.slice(0, 6),
    })),
    seniority_signals: p.seniority_signals.slice(0, 5),
    inferred_roles: p.inferred_roles.slice(0, 3).map((r) => r.role),
  };
}

function parseDecision(raw: string): OrchestratorDecision {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const obj = JSON.parse(cleaned);
  return DecisionSchema.parse(obj) as OrchestratorDecision;
}

/**
 * Apply hard rules that override the LLM:
 *   - 2 consecutive low confidence → drop_difficulty + encourage
 *   - 2 consecutive high correctness → ramp_difficulty
 *   - time low → wrap_up
 */
function applyHeuristics(
  d: OrchestratorDecision,
  input: OrchestratorInput
): OrchestratorDecision {
  const trend = input.confidenceTrend.slice(-2);
  if (trend.length === 2 && trend.every((c) => c < 0.4)) {
    return {
      ...d,
      intent: 'drop_difficulty',
      difficulty: Math.max(1, d.difficulty - 2) as 1 | 2 | 3 | 4 | 5,
      next_question:
        'No worries — let\'s reset with something foundational. ' + d.next_question,
    };
  }

  const corr = input.correctnessTrend.slice(-2);
  if (corr.length === 2 && corr.every((c) => c > 0.85)) {
    return {
      ...d,
      intent: 'ramp_difficulty',
      difficulty: Math.min(5, d.difficulty + 1) as 1 | 2 | 3 | 4 | 5,
    };
  }

  if (input.timeBudgetMinutes < 2) {
    return { ...d, intent: 'wrap_up' };
  }

  return d;
}
