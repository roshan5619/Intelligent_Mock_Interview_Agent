/**
 * Gemini provider — used for:
 *   1. Resume PDF parsing (Gemini natively understands PDF bytes)
 *   2. Embeddings (text-embedding-004)
 *   3. Fallback reasoning when Groq is unavailable
 *
 * Free tier (Google AI Studio, as of 2026-01):
 *   - gemini-2.0-flash: 15 RPM, 1M tokens/day
 *   - text-embedding-004: 1500 RPM
 *
 * Set GOOGLE_GENERATIVE_AI_API_KEY in .env.local.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
  ChatMessage,
  Embedding,
  GenOptions,
  GenerateResult,
  StreamChunk,
} from '../types';
import { MODELS } from '../config';

let client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  if (!client) {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not set');
    client = new GoogleGenerativeAI(apiKey);
  }
  return client;
}

export function isAvailable(): boolean {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

/** Non-streaming generation. */
export async function generate(
  messages: ChatMessage[],
  options: GenOptions = {}
): Promise<GenerateResult> {
  const t0 = Date.now();
  const model = getClient().getGenerativeModel({
    model: MODELS.gemini,
    systemInstruction: extractSystem(messages),
    generationConfig: {
      temperature: options.temperature ?? 0.5,
      topP: options.top_p,
      maxOutputTokens: options.max_tokens ?? 1024,
      responseMimeType: options.json ? 'application/json' : 'text/plain',
    },
  });
  const history = toGeminiHistory(messages);
  const last = history.pop()!;
  const chat = model.startChat({ history });
  const result = await chat.sendMessage(last.parts);
  const text = result.response.text();
  return {
    text,
    provider: 'gemini',
    model: MODELS.gemini,
    durationMs: Date.now() - t0,
  };
}

/** Streaming generation. */
export async function* generateStream(
  messages: ChatMessage[],
  options: GenOptions = {}
): AsyncGenerator<StreamChunk> {
  const model = getClient().getGenerativeModel({
    model: MODELS.gemini,
    systemInstruction: extractSystem(messages),
    generationConfig: {
      temperature: options.temperature ?? 0.5,
      topP: options.top_p,
      maxOutputTokens: options.max_tokens ?? 1024,
      responseMimeType: options.json ? 'application/json' : 'text/plain',
    },
  });
  const history = toGeminiHistory(messages);
  const last = history.pop()!;
  const chat = model.startChat({ history });
  const result = await chat.sendMessageStream(last.parts);
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield { text, done: false };
  }
  yield { text: '', done: true };
}

/**
 * Parse a PDF directly with Gemini — no manual text extraction needed.
 * Gemini accepts inline base64 PDFs up to ~20MB.
 */
export async function generateFromPdf(
  pdfBuffer: Buffer,
  prompt: string,
  options: GenOptions = {}
): Promise<GenerateResult> {
  const t0 = Date.now();
  const model = getClient().getGenerativeModel({
    model: MODELS.geminiPdf,
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.max_tokens ?? 4096,
      responseMimeType: options.json ? 'application/json' : 'text/plain',
    },
  });
  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'application/pdf',
        data: pdfBuffer.toString('base64'),
      },
    },
    { text: prompt },
  ]);
  return {
    text: result.response.text(),
    provider: 'gemini',
    model: MODELS.geminiPdf,
    durationMs: Date.now() - t0,
  };
}

/** Embeddings via text-embedding-004. */
export async function embed(texts: string[]): Promise<Embedding[]> {
  const model = getClient().getGenerativeModel({ model: MODELS.embeddings });
  // The SDK has a batch API but it's not always available; loop is fine
  // for our request volume.
  const out: Embedding[] = [];
  for (const t of texts) {
    const r = await model.embedContent(t);
    out.push(r.embedding.values as Embedding);
  }
  return out;
}

/* ----- helpers ----- */

function extractSystem(messages: ChatMessage[]): string | undefined {
  const sys = messages.find((m) => m.role === 'system');
  return sys?.content;
}

function toGeminiHistory(messages: ChatMessage[]) {
  // Gemini's chat history excludes the system message and uses 'user' / 'model'.
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.content }],
    }));
}
