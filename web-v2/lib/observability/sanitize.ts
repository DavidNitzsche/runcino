/**
 * lib/observability/sanitize.ts · what never reaches `request_failures`.
 *
 * David's explicit instruction: "Never log secrets, auth tokens/session
 * data, HealthKit/health payloads, or unnecessary personal data. Log the
 * correlation ID, timestamp, route path, failure class, HTTP status,
 * duration, and a sanitized error message/stack — not raw payloads."
 *
 * HONESTY ABOUT WHAT THIS CANNOT CATCH (Rule 18 — a check's own header
 * should say what it is structurally incapable of catching, not just what
 * it covers): this is a set of pattern-based redactions over a JS Error's
 * `.message`/`.stack` and a small metadata bag, not a general-purpose PII
 * scanner. It catches the shapes this codebase's own errors are likely to
 * carry (bearer tokens, JWT-shaped strings, Postgres connection strings,
 * email addresses) and refuses to persist any object-valued metadata field
 * at all, on the theory that an object is exactly the shape a raw request
 * body or a HealthKit payload would arrive in. It does NOT attempt to
 * detect free-text PII embedded in an error message that doesn't match one
 * of these patterns (e.g. a name typed into a validation error). Callers
 * remain responsible for not passing a raw request/response body as
 * `metadata` in the first place — this is a second line of defense, not a
 * substitute for that discipline.
 */

const MAX_MESSAGE_CHARS = 500;
const MAX_STACK_CHARS = 3000;
const MAX_STACK_FRAMES = 12;
const MAX_METADATA_STRING_CHARS = 200;

/** Metadata KEYS that are dropped outright, never truncated-and-kept. */
const SECRET_KEY_PATTERN = /token|secret|password|passwd|authoriz|cookie|session|api[-_]?key|dsn|bearer|health|hk_|apple_health|credential/i;

function redactPatterns(input: string): string {
  let s = input;
  // JWT-shaped: three base64url segments joined by dots.
  s = s.replace(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[redacted-jwt]');
  // "Bearer <token>" / "Authorization: <token>"
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]');
  // Postgres / any DB connection string with embedded credentials.
  s = s.replace(/\b\w+:\/\/[^\s'"]*:[^\s'"@]*@[^\s'"]+/g, (m) => {
    const scheme = m.split('://')[0];
    return `${scheme}://[redacted-connstring]`;
  });
  // Email addresses.
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]');
  // Long opaque hex/base64 blobs (32+ chars) that look like API keys/secrets
  // rather than ordinary prose — deliberately conservative (32+, no spaces)
  // so it doesn't eat UUIDs (36 chars but hyphenated) or short ids.
  s = s.replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, (m) => (/^[0-9a-fA-F-]{36}$/.test(m) ? m : '[redacted-blob]'));
  return s;
}

export function sanitizeErrorMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return redactPatterns(raw).slice(0, MAX_MESSAGE_CHARS);
}

export function sanitizeStack(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const capped = raw.split('\n').slice(0, MAX_STACK_FRAMES).join('\n');
  return redactPatterns(capped).slice(0, MAX_STACK_CHARS);
}

/** Metadata is a small, flat, sanitized bag — never a nested object (that is
 *  exactly the shape a request body or health payload would take), never a
 *  secret-named key, and every string value length-capped. */
export function sanitizeMetadata(
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      out[key] = redactPatterns(value).slice(0, MAX_METADATA_STRING_CHARS);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
    // Objects and arrays are dropped entirely — see file header.
  }
  return out;
}
