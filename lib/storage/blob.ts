/**
 * File storage for resume PDFs.
 *
 * Strategy:
 *   - Production: Vercel Blob with PRIVATE access (resumes are sensitive PDFs).
 *     We never expose the URL to the client; the apply pipeline uploads,
 *     persists the URL server-side, and only the server reads it back.
 *   - Local dev:  Falls back to writing into ./data/uploads/ if BLOB_READ_WRITE_TOKEN
 *                 is unset.
 *
 * The interface is minimal — uploadResume() and fetchResume() — so swapping
 * to R2 / S3 later is a single-file change.
 */
import { put, head } from '@vercel/blob';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ulid } from 'ulid';

export type UploadedResume = {
  /** Identifier we persist on the application row. NOT a public URL. */
  url: string;
  filename: string;
};

/**
 * Save a resume PDF and return a stable identifier we can fetch later.
 * `filename` is the original client-side filename (used only for display).
 */
export async function uploadResume(
  bytes: Buffer,
  filename: string
): Promise<UploadedResume> {
  const safeName = sanitizeFilename(filename);
  const key = `resumes/${ulid()}-${safeName}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // Vercel Blob 2.x supports access: 'private'. Our store is configured as
    // private (resumes are sensitive), so we mark each upload private. The
    // returned URL is internal — only the server reads it back via head()
    // which signs the download URL with our token.
    const result = await put(key, bytes, {
      token: process.env.BLOB_READ_WRITE_TOKEN,
      contentType: 'application/pdf',
      addRandomSuffix: false,
      access: 'private',
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

/** Fetch a previously uploaded resume back as a Buffer (server-side only). */
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

  // For private Vercel Blob URLs, we need to look up metadata via head() with
  // our token, which gives us a signed downloadUrl we can fetch.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const meta = await head(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
      const downloadUrl = meta.downloadUrl ?? url;
      const r = await fetch(downloadUrl);
      if (!r.ok) {
        throw new Error(`fetchResume: HTTP ${r.status} from blob URL`);
      }
      return Buffer.from(await r.arrayBuffer());
    } catch (err) {
      // Fall through to direct fetch as a last resort (works for public stores)
      console.warn('[blob] head() failed, trying direct fetch:', err);
    }
  }

  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetchResume: HTTP ${r.status} from ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Strip path components and dangerous chars from an original filename. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/]/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
}
