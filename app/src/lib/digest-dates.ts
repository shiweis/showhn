/**
 * Which day a digest request is for. Days are UTC dates written YYYY-MM-DD.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function isRealDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

/**
 * With no day asked for, the digest shows yesterday, the last complete day.
 * A requested day must be a real date between the first post and today.
 * Anything else returns null and the page answers "not found": without that
 * bound every date had a page linking to the next one, an endless trail for
 * crawlers.
 */
export function resolveDigestDay(requested: string | undefined, earliest: string, today: string): string | null {
  if (!requested) {
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
    return yesterday < earliest ? earliest : yesterday;
  }
  if (!isRealDay(requested) || requested < earliest || requested > today) return null;
  return requested;
}
