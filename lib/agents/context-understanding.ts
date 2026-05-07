/**
 * Agent 1 — Context Understanding Module
 *
 * Pipeline:
 *   1. Extract resume text. Two paths:
 *        a) PDF buffer  → Gemini reads it natively (preferred — no extraction loss).
 *        b) Plain text  → use directly.
 *   2. Pass text to the LLM with the system prompt from
 *      lib/prompts/01_context_understanding.md
 *   3. Parse the JSON response, validate with zod, return as ContextProfile.
 *
 * Contract:
 *   - Input:  Buffer (PDF) | string (text)
 *   - Output: ContextProfile (see lib/storage/types.ts)
 *   - Side effects: NONE (pure function — caller persists the result)
 *
 * Failure modes:
 *   - LLM rate-limited → router fallback chain handles it
 *   - LLM returns malformed JSON → throws ContextParseError
 *   - PDF unreadable → caller gets a generic LLM error
 */
import { z } from 'zod';
import * as llm from '@/lib/llm/client';
import * as gemini from '@/lib/llm/providers/gemini';
import { contextUnderstandingPrompt } from '@/lib/prompts';
import { AGENT_CONFIG } from '@/lib/llm/config';
import type { ContextProfile } from '@/lib/storage/types';

/* ----------------------------------------------------------------- schema */

const ContextProfileSchema = z.object({
  skills: z.array(z.string()),
  years_total: z.number(),
  roles: z.array(
    z.object({
      title: z.string(),
      org: z.string().optional(),
      years: z.number().optional(),
    })
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      summary: z.string(),
      impact: z.string().optional(),
      tech: z.array(z.string()).optional(),
    })
  ),
  education: z.array(
    z.object({
      degree: z.string(),
      school: z.string().optional(),
      year: z.number().optional(),
    })
  ),
  certs: z.array(z.string()),
  domains: z.array(z.string()),
  seniority_signals: z.array(z.string()),
  inferred_roles: z.array(
    z.object({
      role: z.string(),
      confidence: z.number().min(0).max(1),
      rationale: z.string(),
      matched_evidence: z.array(z.string()),
    })
  ),
});

export class ContextParseError extends Error {
  constructor(message: string, public raw: string) {
    super(message);
    this.name = 'ContextParseError';
  }
}

/* ----------------------------------------------------------------- entry points */

/**
 * Parse a resume PDF buffer into a ContextProfile.
 *
 * Two-stage fallback:
 *   1. Try Gemini's native PDF understanding (no extraction loss).
 *   2. If Gemini is rate-limited / unavailable, fall back to
 *      extracting text via pdf-parse and routing through `parseResumeText`
 *      (which has its own router fallback Groq → Gemini → Ollama).
 */
export async function parseResumePdf(pdf: Buffer): Promise<ContextProfile> {
  const prompt = contextUnderstandingPrompt();

  if (gemini.isAvailable()) {
    try {
      const result = await gemini.generateFromPdf(pdf, prompt, {
        temperature: 0.2,
        json: true,
        max_tokens: 4096,
      });
      return parseAndValidate(result.text);
    } catch (err) {
      console.warn('[context-understanding] Gemini PDF failed, falling back to text extraction:', err);
      // fall through
    }
  }

  // Fallback: extract text from PDF and use the standard text path.
  // pdf-parse is a CommonJS module; dynamic import keeps it out of edge bundles.
  const pdfParseMod = (await import('pdf-parse')).default as (
    buf: Buffer
  ) => Promise<{ text: string }>;
  const { text } = await pdfParseMod(pdf);
  if (!text || text.trim().length < 30) {
    throw new ContextParseError(
      'PDF text extraction yielded too little content',
      text ?? ''
    );
  }
  return parseResumeText(text);
}

/** Parse already-extracted resume text. */
export async function parseResumeText(text: string): Promise<ContextProfile> {
  const cfg = AGENT_CONFIG['context-understanding'];
  const result = await llm.generate({
    preferProvider: cfg.preferProvider,
    options: cfg.options,
    messages: [
      { role: 'system', content: contextUnderstandingPrompt() },
      {
        role: 'user',
        content:
          '## RESUME\n\n' +
          text +
          '\n\n## TASK\n\nParse this resume and respond with a JSON object as specified.',
      },
    ],
  });
  return parseAndValidate(result.text);
}

/* ----------------------------------------------------------------- helpers */

function parseAndValidate(raw: string): ContextProfile {
  // Some providers wrap JSON in ```json fences despite our instructions.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (err) {
    throw new ContextParseError(
      `LLM returned non-JSON: ${(err as Error).message}`,
      raw
    );
  }

  const result = ContextProfileSchema.safeParse(obj);
  if (!result.success) {
    throw new ContextParseError(
      `Schema validation failed: ${result.error.message}`,
      raw
    );
  }
  return result.data as ContextProfile;
}
