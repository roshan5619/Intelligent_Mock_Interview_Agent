/**
 * File storage for resume PDFs.
 *
 * Strategy:
 *   - Production: Vercel Blob (managed, signed URLs, free tier 1GB)
 *   - Local dev:  Falls back to writing into ./data/uploads/ if BLOB_READ_WRITE_TOKEN is unset
 *
 * We keep the interface minimal — uploadResume() and fetchResume() — so swapping
 * to R2 / S3 later is a single-file change.
 */
import { put } from '@vercel/blob';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ulid } from 'ulid';

export type UploadedResume = {
  url: string;
  filename: string;
};

/**
 * Save a resume PDF and return a stable URL we can fetch later.
 * `filename` is the original client-side filename (used only for display).
 */
export async function uploadResume(
  bytes: Buffer,
  filename: string
): Promise<UploadedResume> {
  const safeName = sanitizeFilename(filename);
  const key = `resumes/${ulid()}-${safeName}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const result = await put(key, bytes, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      contentType: 'application/pdf',
    });
    return { url: result.url, filename: safeName };
  }

  // Local-dev fallback: write to ./data/uploads/ and serve via a relative URL
  // (which the Next.js dev server can read directly when needed).
  const uploadsDir = resolve(process.cwd(), 'data', 'uploads');
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  const localPath = resolve(uploadsDir, key.replace('/', '__'));
  writeFileSync(localPath, bytes);
  return {
    url: `local://${key.replace('/', '__')}`,
    filename: safeName,
  };
}

/** Fetch a previously uploaded resume back as a Buffer. */
export async function fetchResume(url: string): Promise<Buffer> {
  if (url.startsWith('local://')) {
    const localPath = resolve(
      process.cwd(),
      'data',
      'uploads',
      url.replace('local://', '')
    );
    return readFileSync(localPath);
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetchResume: HTTP ${r.status} from ${url}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

/** Strip path components and dangerous chars from an original filename. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/]/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
}
