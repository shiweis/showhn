/**
 * Which stretch of time an ingest run reads from the HN search API.
 */

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/**
 * Every run re-reads this much before the newest post already stored. The
 * search sometimes indexes posts hours late (during the Aug 23-24, 2026 gap it
 * added posts for a day-long stretch after the fact), and a re-read also
 * brings fresh points and comment counts for every post under a day old.
 */
export const INGEST_OVERLAP_SECONDS = DAY;

/**
 * Where a regular ingest run starts reading. It resumes from the newest post
 * already stored, less the overlap, so the first run after an outage of any
 * length fills the gap. A fixed two-hour lookback lost every post older than
 * that for good, and every post the search indexed more than two hours late.
 */
export function resumeFrom(newestStoredAt: number | null, now: number): number {
  const recent = now - INGEST_OVERLAP_SECONDS;
  if (newestStoredAt === null) return recent;
  return Math.min(recent, newestStoredAt - INGEST_OVERLAP_SECONDS);
}

/**
 * Split a range into windows of at most a day, oldest first. Each window
 * covers posts created after `from` and up to `to`, so neighbouring windows
 * neither overlap nor leave a gap. The search returns at most 1,000 hits per
 * query, far more than one day of Show HN posts but far fewer than 30 days.
 */
export function ingestWindows(from: number, to: number, windowSeconds = DAY): { from: number; to: number }[] {
  const windows: { from: number; to: number }[] = [];
  for (let start = from; start < to; start += windowSeconds) {
    windows.push({ from: start, to: Math.min(start + windowSeconds, to) });
  }
  return windows;
}
