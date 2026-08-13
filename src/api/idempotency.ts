/**
 * Idempotency keys and retry pacing for `POST /sandboxes`.
 *
 * Note this SDK already jitters its backoff (see `ApiClient.delay` —
 * exponential with an equal-jitter multiplier), unlike the Go and Python
 * clients which used a deterministic `delay * attempt`. Only the key and the
 * response-code handling are new here.
 */

/**
 * Machine-readable error codes returned by `POST /sandboxes`.
 *
 * Branch on these, never on the message. It matters most where one status means
 * several unrelated things, and only one of them is retryable.
 */

/**
 * 409 — the original create carrying this key is still running. Retrying the
 * IDENTICAL request is correct, and is how a caller recovers the sandbox ID
 * after a lost response. `Retry-After` is set.
 */
export const CODE_IDEMPOTENCY_IN_PROGRESS = 'idempotency_in_progress';

/**
 * 422 — the key was already used with different parameters. Not retryable; the
 * caller must generate a fresh key per logical create.
 */
export const CODE_IDEMPOTENCY_KEY_REUSED = 'idempotency_key_reused';

/**
 * 409 — unrelated to idempotency; the template needs a rebuild. Retrying the
 * request unchanged cannot fix it.
 */
export const CODE_TEMPLATE_NOT_READY = 'template_not_ready';

/** Never let a server pin a client for minutes on a `Retry-After`. */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Generate a key for one *logical* create.
 *
 * Call this ONCE per create and reuse it across that call's retries. A fresh
 * key per attempt defeats the mechanism entirely: the server treats every retry
 * as a new create, which is the duplicate-sandbox bug the key exists to prevent.
 *
 * Uses `crypto.randomUUID()` where available — a CSPRNG, which is what this
 * needs, since a collision between two tenants' concurrent creates would return
 * one caller the other's sandbox. Falls back to `getRandomValues` for older
 * runtimes that lack `randomUUID` but still have Web Crypto.
 */
export function newIdempotencyKey(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return (
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
      `${hex.slice(16, 20)}-${hex.slice(20)}`
    );
  }
  // No CSPRNG: send no key rather than a weak one. Math.random() is seeded and
  // predictable, and a guessable key is worse than none — the request simply
  // behaves as it did before idempotency existed.
  return '';
}

/**
 * Read a `Retry-After` expressed in seconds, as milliseconds.
 *
 * Returns `undefined` when absent or unparseable so the caller falls back to its
 * own backoff. The HTTP-date form is deliberately unsupported: this API does not
 * emit it, and guessing wrong would sleep for hours.
 */
export function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('Retry-After');
  if (raw === null) return undefined;
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs < 0) return undefined;
  return Math.min(secs * 1000, MAX_RETRY_AFTER_MS);
}
