/**
 * Ollama provider — OPTIONAL offline fallback.
 *
 * Activated only when:
 *   1. The user has set OLLAMA_BASE_URL (or it's running on the default localhost), AND
 *   2. Both Groq and Gemini have failed.
 *
 * Speaks the OpenAI-compatible /v1/chat/completions endpoint that Ollama exposes,
 * so we don't need a separate SDK. Uses fetch only — zero extra deps.
 */
import type {
  ChatMessage,
  Embedding,
  GenOptions,
  GenerateResult,
  StreamChunk,
} from '../types';
import { MODELS } from '../config';

const DEFAULT_URL = 'http://localhost:11434';

function baseUrl(): string {
  return process.env.OLLAMA_BASE_URL || DEFAULT_URL;
}

/**
 * We can't synchronously know if Ollama is running, so this returns true if
 * the user opted in (set OLLAMA_BASE_URL) OR if we're explicitly told to try
 * by the router's last-resort fallback. The actual ping is done in `ping()`.
 */
export function isAvailable(): boolean {
  return Boolean(process.env.OLLAMA_BASE_URL);
}

export async function ping(): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl()}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function generate(
  messages: ChatMessage[],
  options: GenOptions = {}
): Promise<GenerateResult> {
  const t0 = Date.now();
  const r = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.ollama,
      messages,
      temperature: options.temperature ?? 0.5,
      top_p: options.top_p ?? 1,
      max_tokens: options.max_tokens ?? 1024,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!r.ok) {
    throw new Error(`Ollama generate failed: ${r.status} ${await r.text()}`);
  }
  const data = await r.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';
  return {
    text,
    provider: 'ollama',
    model: MODELS.ollama,
    durationMs: Date.now() - t0,
  };
}

export async function* generateStream(
  messages: ChatMessage[],
  options: GenOptions = {}
): AsyncGenerator<StreamChunk> {
  const r = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.ollama,
      messages,
      temperature: options.temperature ?? 0.5,
      top_p: options.top_p ?? 1,
      max_tokens: options.max_tokens ?? 1024,
      stream: true,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!r.ok || !r.body) {
    throw new Error(`Ollama stream failed: ${r.status}`);
  }

  const decoder = new TextDecoder();
  const reader = r.body.getReader();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // OpenAI-compatible streams use SSE-style "data: {...}\n\n" lines
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const m = line.match(/^data: (.+)$/);
      if (!m) continue;
      const payload = m[1].trim();
      if (payload === '[DONE]') {
        yield { text: '', done: true };
        return;
      }
      try {
        const obj = JSON.parse(payload);
        const delta = obj.choices?.[0]?.delta?.content ?? '';
        if (delta) yield { text: delta, done: false };
      } catch {
        // ignore malformed line
      }
    }
  }
  yield { text: '', done: true };
}

export async function embed(texts: string[]): Promise<Embedding[]> {
  const out: Embedding[] = [];
  for (const t of texts) {
    const r = await fetch(`${baseUrl()}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODELS.embeddingsOllama, prompt: t }),
    });
    if (!r.ok) throw new Error(`Ollama embed failed: ${r.status}`);
    const data = await r.json();
    out.push(data.embedding as Embedding);
  }
  return out;
}
