/**
 * LLM router — the single entry point every server-side agent calls.
 *
 * - `generate(req)`        → non-streaming, returns the full text
 * - `generateStream(req)`  → async iterable of token chunks (SSE-friendly)
 * - `generateFromPdf(...)` → multimodal: hand a PDF buffer to Gemini
 * - `embed(texts)`         → vector embeddings (Gemini → Ollama fallback)
 *
 * Provider selection:
 *   - Each call has a preferred provider (from AGENT_CONFIG or override).
 *   - On error (rate limit, network, missing key), the router falls back
 *     through the chain: preferred → groq → gemini → ollama.
 *   - Each provider is skipped silently if its API key is unset.
 */
import * as groq from './providers/groq';
import * as gemini from './providers/gemini';
import * as ollama from './providers/ollama';
import type {
  Embedding,
  GenOptions,
  GenerateRequest,
  GenerateResult,
  ProviderName,
  StreamChunk,
} from './types';

type Provider = {
  name: ProviderName;
  isAvailable: () => boolean;
  generate: typeof groq.generate;
  generateStream: typeof groq.generateStream;
  embed: typeof groq.embed;
};

const PROVIDERS: Record<ProviderName, Provider> = {
  groq: {
    name: 'groq',
    isAvailable: groq.isAvailable,
    generate: groq.generate,
    generateStream: groq.generateStream,
    embed: groq.embed,
  },
  gemini: {
    name: 'gemini',
    isAvailable: gemini.isAvailable,
    generate: gemini.generate,
    generateStream: gemini.generateStream,
    embed: gemini.embed,
  },
  ollama: {
    name: 'ollama',
    isAvailable: ollama.isAvailable,
    generate: ollama.generate,
    generateStream: ollama.generateStream,
    embed: ollama.embed,
  },
};

/** Build the fallback chain: preferred first, then the others, in default order. */
function chain(prefer?: ProviderName): Provider[] {
  const order: ProviderName[] = ['groq', 'gemini', 'ollama'];
  const front = prefer ? [prefer] : [];
  const rest = order.filter((p) => p !== prefer);
  return [...front, ...rest]
    .map((n) => PROVIDERS[n])
    .filter((p) => p.isAvailable());
}

export async function generate(req: GenerateRequest): Promise<GenerateResult> {
  const providers = chain(req.preferProvider);
  if (providers.length === 0) {
    throw new Error(
      'No LLM provider available. Set GROQ_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY in .env.local.'
    );
  }
  let lastErr: unknown;
  for (const p of providers) {
    try {
      return await p.generate(req.messages, req.options ?? {});
    } catch (err) {
      lastErr = err;
      console.warn(`[llm] ${p.name} failed, trying next:`, errMessage(err));
    }
  }
  throw new Error(
    `All LLM providers failed. Last error: ${errMessage(lastErr)}`
  );
}

export async function* generateStream(
  req: GenerateRequest
): AsyncGenerator<StreamChunk & { provider?: ProviderName }> {
  const providers = chain(req.preferProvider);
  if (providers.length === 0) {
    throw new Error(
      'No LLM provider available. Set GROQ_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY in .env.local.'
    );
  }
  let lastErr: unknown;
  for (const p of providers) {
    try {
      let firstChunk = true;
      for await (const c of p.generateStream(req.messages, req.options ?? {})) {
        if (firstChunk) {
          yield { ...c, provider: p.name };
          firstChunk = false;
        } else {
          yield c;
        }
      }
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[llm] ${p.name} stream failed, trying next:`, errMessage(err));
    }
  }
  throw new Error(
    `All LLM providers failed for streaming. Last error: ${errMessage(lastErr)}`
  );
}

/** Multimodal helper: only Gemini supports PDF natively in our stack. */
export async function generateFromPdf(
  pdfBuffer: Buffer,
  prompt: string,
  options: GenOptions = {}
): Promise<GenerateResult> {
  if (gemini.isAvailable()) {
    return gemini.generateFromPdf(pdfBuffer, prompt, options);
  }
  // Fallback: extract text first (caller should have done this) — but if we got here
  // with a raw buffer and no Gemini, we can't help.
  throw new Error(
    'PDF parsing requires GOOGLE_GENERATIVE_AI_API_KEY (Gemini natively reads PDFs).'
  );
}

/** Embeddings: prefer Gemini (high-quality, free, 768-dim), fall back to Ollama. */
export async function embed(texts: string[]): Promise<{
  vectors: Embedding[];
  provider: ProviderName;
}> {
  const order: ProviderName[] = ['gemini', 'ollama'];
  let lastErr: unknown;
  for (const name of order) {
    const p = PROVIDERS[name];
    if (!p.isAvailable()) continue;
    try {
      const vectors = await p.embed(texts);
      return { vectors, provider: p.name };
    } catch (err) {
      lastErr = err;
      console.warn(`[llm/embed] ${p.name} failed:`, errMessage(err));
    }
  }
  throw new Error(`No embedding provider succeeded. Last: ${errMessage(lastErr)}`);
}

/** Diagnostic helper used by /api/health and the demo banner. */
export function availableProviders(): ProviderName[] {
  return (Object.keys(PROVIDERS) as ProviderName[]).filter((n) =>
    PROVIDERS[n].isAvailable()
  );
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
