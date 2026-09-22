/**
 * Shared exponential backoff for free-tier API rate limits / transient errors.
 */

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableMessage(message: string): boolean {
  if (/404|not found|no longer available/i.test(message)) return false;
  return /\b429\b|rate[_\s-]?limit|quota[_\s-]?(exceeded|exhausted)|timeout|ETIMEDOUT|ECONNRESET|temporar|unavailable|503|502|overloaded/i.test(
    message,
  );
}

export type BackoffOptions = {
  /** Extra attempts after the first call (default 3 → 4 total tries). */
  retries?: number;
  /** Base delay in ms before the first retry (default 800). */
  baseMs?: number;
  /** Cap on delay per attempt (default 30s). */
  maxMs?: number;
};

/**
 * Retry `fn` with exponential backoff (+ small jitter) on rate limits,
 * quotas, timeouts, and other transient failures.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts?: BackoffOptions,
): Promise<T> {
  const retries = opts?.retries ?? 3;
  const baseMs = opts?.baseMs ?? 800;
  const maxMs = opts?.maxMs ?? 30_000;
  let lastErr: unknown;

  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isRetryableMessage(msg) || i === retries) throw err;
      const delay = Math.min(maxMs, baseMs * 2 ** i);
      const jitter = Math.floor(Math.random() * 250);
      await sleep(delay + jitter);
    }
  }

  throw lastErr;
}
