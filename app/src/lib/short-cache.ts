/**
 * Keeps results for a short time, in this process only.
 *
 * For lists and numbers that take a pass over every post to work out and that
 * change slowly, such as the all-time views. Each web process has its own
 * copy, and nothing is kept across a restart.
 */
export function createShortCache({
  ttlMs,
  maxEntries = 200,
  now = Date.now,
}: {
  /** How long a result is reused, in milliseconds. */
  ttlMs: number;
  /** The oldest result is dropped once there are more than this many. */
  maxEntries?: number;
  now?: () => number;
}) {
  const entries = new Map<string, { at: number; value: unknown }>();

  /** The remembered result for `key`, or what `compute` returns when there is none or it is too old. */
  function get<T>(key: string, compute: () => T): T {
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value as T;

    const value = compute();
    entries.delete(key);
    entries.set(key, { at: now(), value });
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);

    // A lookup that fails must be tried again by the next caller, not served from here.
    if (value instanceof Promise) {
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
    }
    return value;
  }

  return { get, clear: () => entries.clear() };
}
