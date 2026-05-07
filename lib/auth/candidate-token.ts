/**
 * No-auth candidate identity for the prototype.
 *
 * After resume upload, we issue a signed cookie containing the candidate's ID.
 * The signature is HMAC-SHA256 over the payload, keyed by HMAC_SECRET. This
 * prevents anyone from forging another candidate's ID without breaking the secret.
 *
 * Format: `<base64url(payload)>.<base64url(signature)>`
 *   payload = JSON.stringify({ candidateId, iat })
 *
 * For v2 we'll replace this with Supabase Auth magic-link (see plan §17).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'iphipi_candidate';

type Payload = {
  candidateId: string;
  /** Issued-at, unix seconds. */
  iat: number;
};

export const CANDIDATE_COOKIE_NAME = COOKIE_NAME;

/** Sign a candidate ID into a cookie value. */
export function signCandidateToken(candidateId: string): string {
  const payload: Payload = {
    candidateId,
    iat: Math.floor(Date.now() / 1000),
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sigB64 = b64url(hmac(payloadB64));
  return `${payloadB64}.${sigB64}`;
}

/** Verify a token; return the candidate ID or null on any failure. */
export function verifyCandidateToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const expected = hmac(payloadB64);
  const got = unb64url(sigB64);
  if (expected.length !== got.length) return null;
  if (!timingSafeEqual(expected, got)) return null;
  try {
    const payload = JSON.parse(unb64url(payloadB64).toString('utf8')) as Payload;
    if (typeof payload.candidateId !== 'string') return null;
    return payload.candidateId;
  } catch {
    return null;
  }
}

function getSecret(): Buffer {
  const s = process.env.HMAC_SECRET;
  if (!s) {
    throw new Error(
      'HMAC_SECRET is not set. Generate one and add to .env.local. ' +
        '(PowerShell: [Convert]::ToBase64String((1..32 | % { Get-Random -Maximum 256 })))'
    );
  }
  return Buffer.from(s, 'utf8');
}

function hmac(input: string): Buffer {
  return createHmac('sha256', getSecret()).update(input).digest();
}

function b64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function unb64url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}
