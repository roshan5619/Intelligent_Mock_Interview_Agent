/**
 * Groq provider — primary reasoner.
 *
 * Free tier limits (as of 2026-01): 30 RPM, 14,400 RPD on llama-3.3-70b-versatile.
 * Inference speed: ~500 tok/s — by far the fastest hosted LLM today.
 *
 * Set GROQ_API_KEY in .env.local. If absent, this provider self-reports as
 * unavailable and the router skips it.
 */
import Groq from 'groq-sdk';
import type {
  ChatMessage,
  Embedding,
  GenOptions,
  GenerateResult,
  StreamChunk,
} from '../types';
import { MODELS } from '../config';

let client: Groq | null = null;
function getClient(): Groq {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY is not set');
    client = new Groq({ apiKey });
  }
  return client;
}

export function isAvailable(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

/** Non-streaming generation. */
export async function generate(
  messages: ChatMessage[],
  options: GenOptions = {}
): Promise<GenerateResult> {
  const t0 = Date.now();
  const c = getClient();
  const completion = await c.chat.completions.create({
    model: MODELS.groq,
    messages: prepMessages(messages, options.json),
    temperature: options.temperature ?? 0.5,
    top_p: options.top_p ?? 1,
    max_tokens: options.max_tokens ?? 1024,
    response_format: options.json ? { type: 'json_object' } : undefined,
  });
  const text = completion.choices[0]?.message?.content ?? '';
  return {
    text,
    provider: 'groq',
    model: MODELS.groq,
    durationMs: Date.now() - t0,
  };
}

/** Streaming generation — yields chunks as they arrive. */
export async function* generateStream(
  messages: ChatMessage[],
  options: GenOptions = {}
): AsyncGenerator<StreamChunk> {
  const c = getClient();
  const stream = await c.chat.completions.create({
    model: MODELS.groq,
    messages: prepMessages(messages, options.json),
    temperature: options.temperature ?? 0.5,
    top_p: options.top_p ?? 1,
    max_tokens: options.max_tokens ?? 1024,
    response_format: options.json ? { type: 'json_object' } : undefined,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    if (delta) yield { text: delta, done: false };
  }
  yield { text: '', done: true };
}

/** Groq does not currently expose embeddings — embedding requests are routed to Gemini instead. */
export async function embed(_texts: string[]): Promise<Embedding[]> {
  throw new Error('Groq does not support embeddings — use Gemini provider');
}

/* ----- helpers ----- */

/**
 * Groq's response_format=json_object mode requires the word "json" somewhere
 * in the prompt. We append a soft hint to the system message so callers don't
 * have to remember.
 */
function prepMessages(messages: ChatMessage[], json?: boolean) {
  if (!json) return messages;
  const out = [...messages];
  const sysIdx = out.findIndex((m) => m.role === 'system');
  if (sysIdx >= 0) {
    out[sysIdx] = {
      ...out[sysIdx],
      content:
        out[sysIdx].content +
        '\n\nYou MUST respond with valid JSON only. No prose, no markdown fences.',
    };
  } else {
    out.unshift({
      role: 'system',
      content:
        'You MUST respond with valid JSON only. No prose, no markdown fences.',
    });
  }
  return out;
}
