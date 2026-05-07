/**
 * Embedding-vector helpers: cosine similarity + simple chunking.
 * Self-contained, no deps — easy to unit test.
 */
import type { Embedding } from '@/lib/llm/types';

/** Cosine similarity, range [-1, 1]; 1 = identical direction. */
export function cosineSim(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSim: length mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Chunk a long text into roughly-sized pieces for embedding.
 * Greedy by paragraph, with a soft character target.
 */
export function chunkText(text: string, target = 500): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > target * 2 && buf.length > 0) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + '\n\n' + p : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/** Mean-pool a set of embeddings into a single vector (simple but effective). */
export function meanPool(vectors: Embedding[]): Embedding {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}
