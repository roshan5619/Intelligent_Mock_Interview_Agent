/**
 * Agent 3 — Audio Intelligence (server scoring half)
 *
 * Browser collects raw signals via Web Audio API + Web Speech transcript
 * (see lib/voice/audio-analyzer.ts). This module takes that AudioMetrics
 * blob plus the transcript and produces:
 *   - confidence  (0-1)
 *   - clarity     (0-1)
 *   - evidence    (1 sentence)
 *   - signals_summary (1 sentence)
 */
import { z } from 'zod';
import * as llm from '@/lib/llm/client';
import { audioScoringPrompt } from '@/lib/prompts';
import { AGENT_CONFIG } from '@/lib/llm/config';
import type { AudioMetrics } from '@/lib/storage/types';

export type AudioScore = {
  confidence: number;
  clarity: number;
  evidence: string;
  signals_summary: string;
};

const Schema = z.object({
  confidence: z.number().min(0).max(1),
  clarity: z.number().min(0).max(1),
  evidence: z.string(),
  signals_summary: z.string(),
});

export async function scoreAudio(input: {
  transcript: string;
  metrics: AudioMetrics;
}): Promise<AudioScore> {
  const cfg = AGENT_CONFIG['audio-intelligence'];
  const result = await llm.generate({
    preferProvider: cfg.preferProvider,
    options: cfg.options,
    messages: [
      { role: 'system', content: audioScoringPrompt() },
      {
        role: 'user',
        content: [
          `TRANSCRIPT: ${input.transcript || '(empty)'}`,
          'AUDIO METRICS:',
          `  wpm: ${input.metrics.wpm.toFixed(1)}`,
          `  fillers_per_min: ${input.metrics.fillers_per_min.toFixed(1)}`,
          `  pause_ratio: ${input.metrics.pause_ratio.toFixed(2)}`,
          `  pitch_mean_hz: ${input.metrics.pitch_mean_hz.toFixed(1)}`,
          `  pitch_variance: ${input.metrics.pitch_variance.toFixed(1)}`,
          `  rms_mean: ${input.metrics.rms_mean.toFixed(3)}`,
          `  rms_variance: ${input.metrics.rms_variance.toFixed(3)}`,
          `  silence_pct: ${input.metrics.silence_pct.toFixed(2)}`,
          '',
          'Score this turn. Output JSON only.',
        ].join('\n'),
      },
    ],
  });
  const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return Schema.parse(JSON.parse(cleaned)) as AudioScore;
}
