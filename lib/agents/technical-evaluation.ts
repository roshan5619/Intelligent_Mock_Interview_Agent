/**
 * Agent 5 — Technical Evaluation Engine
 *
 * Scores a single candidate answer against the question.
 * Output is structured JSON used both per-turn (for the orchestrator's
 * adaptation logic) and at end-of-session (for the report).
 */
import { z } from 'zod';
import * as llm from '@/lib/llm/client';
import { technicalEvaluationPrompt } from '@/lib/prompts';
import { AGENT_CONFIG } from '@/lib/llm/config';
import type { ContextProfile } from '@/lib/storage/types';

export type TechnicalScore = {
  correctness: number;
  depth: number;
  specificity: number;
  concept_coverage: number;
  evidence_quote: string;
  flags: string[];
};

const TechnicalScoreSchema = z.object({
  correctness: z.number().min(0).max(1),
  depth: z.number().min(0).max(1),
  specificity: z.number().min(0).max(1),
  concept_coverage: z.number().min(0).max(1),
  evidence_quote: z.string(),
  flags: z.array(z.string()),
});

export type TechEvalInput = {
  question: string;
  focusArea: string;
  expectedConcepts: string[];
  candidateProfile: ContextProfile;
  candidateAnswer: string;
};

export async function scoreAnswer(input: TechEvalInput): Promise<TechnicalScore> {
  const cfg = AGENT_CONFIG['technical-evaluation'];
  const result = await llm.generate({
    preferProvider: cfg.preferProvider,
    options: cfg.options,
    messages: [
      { role: 'system', content: technicalEvaluationPrompt() },
      {
        role: 'user',
        content: [
          `QUESTION: ${input.question}`,
          `FOCUS AREA: ${input.focusArea}`,
          `EXPECTED CONCEPTS: ${input.expectedConcepts.join(', ') || '(infer from question)'}`,
          `CANDIDATE PROFILE (abbrev): skills=${input.candidateProfile.skills.slice(0, 12).join(',')}; years=${input.candidateProfile.years_total}`,
          `CANDIDATE ANSWER: ${input.candidateAnswer || '(no answer)'}`,
          '',
          'Score the answer. Output JSON only.',
        ].join('\n'),
      },
    ],
  });

  const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const obj = JSON.parse(cleaned);
  return TechnicalScoreSchema.parse(obj) as TechnicalScore;
}
