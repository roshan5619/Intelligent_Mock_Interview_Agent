/**
 * Per-agent LLM config — sampling parameters and which provider to prefer.
 *
 * We keep all six agents on the same primary model (Groq Llama 3.3 70B) but
 * tune temperature/top_p so each agent has the right "personality":
 *
 *   - Context Understanding & Technical Eval: low temp (deterministic JSON)
 *   - Orchestrator: medium temp (creative question generation)
 *   - Feedback & Coaching: medium-high (warm, narrative)
 *   - Audio scoring: low (deterministic)
 *
 * Resume PDF parsing is special: it goes to Gemini 2.0 Flash because Gemini
 * can read PDFs directly (no text extraction step needed).
 */
import type { GenOptions, ProviderName } from './types';

/** Stable name for each agent — used as a key into AGENT_CONFIG. */
export type AgentKey =
  | 'context-understanding'
  | 'orchestrator'
  | 'audio-intelligence'
  | 'technical-evaluation'
  | 'feedback-coaching'
  | 'jd-match-rationale';

export type AgentConfig = {
  preferProvider: ProviderName;
  options: GenOptions;
};

/** The base reasoner used by all server agents (provider-specific names). */
export const MODELS = {
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.0-flash',
  geminiPdf: 'gemini-2.0-flash',
  ollama: 'llama3.2:3b-instruct-q4_K_M',
  embeddings: 'text-embedding-004',
  embeddingsOllama: 'nomic-embed-text',
} as const;

export const AGENT_CONFIG: Record<AgentKey, AgentConfig> = {
  // Resume parsing happens in two stages: PDF→text via Gemini, then any
  // post-processing on Groq. The agent uses the JSON path of the router.
  'context-understanding': {
    preferProvider: 'gemini',
    options: { temperature: 0.2, json: true, max_tokens: 4096 },
  },
  // The orchestrator is the conversational driver — needs warmth + variety.
  orchestrator: {
    preferProvider: 'groq',
    options: { temperature: 0.7, top_p: 0.9, max_tokens: 800 },
  },
  // Audio scoring takes structured signals and outputs a structured score.
  'audio-intelligence': {
    preferProvider: 'groq',
    options: { temperature: 0.1, json: true, max_tokens: 600 },
  },
  // Technical eval must be reproducible and rubric-faithful.
  'technical-evaluation': {
    preferProvider: 'groq',
    options: { temperature: 0.2, json: true, max_tokens: 1200 },
  },
  // The final report — narrative, encouraging, specific.
  'feedback-coaching': {
    preferProvider: 'groq',
    options: { temperature: 0.6, max_tokens: 3000 },
  },
  // Per-job "why this fits" rationales, batched.
  'jd-match-rationale': {
    preferProvider: 'groq',
    options: { temperature: 0.4, max_tokens: 1500 },
  },
};
