import crypto from 'node:crypto';
import { config } from '../config.js';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateClientId() {
  return 'mcp_' + crypto.randomBytes(16).toString('hex');
}

export function generateClientSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

// PKCE S256 verification: hashed verifier must equal the challenge.
export function verifyPkceS256(verifier, challenge) {
  if (!verifier || !challenge) return false;
  const hashed = crypto.createHash('sha256').update(verifier).digest('base64url');
  return crypto.timingSafeEqual(Buffer.from(hashed), Buffer.from(challenge));
}

// Verify HMAC-SHA256 consent token issued by the chess server.
// Returns the parsed payload, or null if invalid/expired.
export function verifyConsentToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expected = crypto
    .createHmac('sha256', config.mcpServiceSecret)
    .update(payloadB64)
    .digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

// Convert seconds offset to ISO-8601 string suitable for SQLite TEXT column.
export function expiresAtIso(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
