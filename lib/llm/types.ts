/**
 * Shared LLM types — used by every provider and every agent.
 *
 * The router accepts a normalized request shape and each provider adapter
 * translates it to its native SDK call. Keep this file SDK-free so it can be
 * imported anywhere without pulling provider deps.
 */

/** Logical providers we support. Order = default fallback order. */
export type ProviderName = 'groq' | 'gemini' | 'ollama';

/** A single chat message. Roles map cleanly across all three providers. */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/** Sampling and shape controls. All optional; sensible defaults applied. */
export type GenOptions = {
  /** 0..2 typical; lower = more deterministic */
  temperature?: number;
  /** nucleus sampling */
  top_p?: number;
  /** maximum output tokens */
  max_tokens?: number;
  /** if true, response must be valid JSON. We pass `response_format` to providers that support it AND wrap the prompt with a "respond in JSON" instruction. */
  json?: boolean;
};

/** Logical request — what every agent passes into `lib/llm/client.ts`. */
export type GenerateRequest = {
  messages: ChatMessage[];
  options?: GenOptions;
  /** Override the default provider chain for this call. */
  preferProvider?: ProviderName;
};

/** Streaming and non-streaming results share this envelope. */
export type GenerateResult = {
  text: string;
  /** Which provider actually produced this result (after fallbacks). */
  provider: ProviderName;
  /** The model name the provider used. */
  model: string;
  /** Total ms from first byte to last byte. */
  durationMs: number;
};

/** A token-by-token stream — what `generateStream` yields. */
export type StreamChunk = {
  text: string;
  done: boolean;
};

/** Single embedding (returned as a flat number[] vector). */
export type Embedding = number[];
