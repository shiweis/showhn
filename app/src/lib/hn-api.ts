/**
 * HN API clients for data refresh.
 *
 * - fetchItemState: Single item via HN Firebase API (on-demand refresh, and posts the search no longer returns)
 * - fetchItemsBatched: Multiple items via Algolia objectID filter (for cron refresh)
 */

const HN_FIREBASE_BASE = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA_SEARCH_BASE = "https://hn.algolia.com/api/v1/search";

/**
 * What HN itself says about one item. "dead" means killed by flags or
 * moderators, "deleted" means removed by its author. "unknown" means the
 * lookup failed or came back empty: it never means the item is gone.
 */
export type HNItemState =
  | { state: "live"; score: number; descendants: number }
  | { state: "dead" | "deleted" | "unknown" };

/** Look up one item on the HN Firebase API. */
export async function fetchItemState(id: number): Promise<HNItemState> {
  try {
    const res = await fetch(`${HN_FIREBASE_BASE}/item/${id}.json`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { state: "unknown" };
    const data = await res.json();
    if (!data) return { state: "unknown" };
    if (data.deleted) return { state: "deleted" };
    if (data.dead) return { state: "dead" };
    return { state: "live", score: data.score ?? 0, descendants: data.descendants ?? 0 };
  } catch {
    return { state: "unknown" };
  }
}

export interface AlgoliaRefreshHit {
  objectID: string;
  points: number;
  num_comments: number;
}

/**
 * Fetch multiple items via Algolia objectID filter in batches.
 * Used by cron refresh to update stale posts efficiently.
 *
 * Chunks IDs into groups of `batchSize`, fetches each batch with a single
 * Algolia request using `filters=objectID:X OR objectID:Y ...`,
 * with `delayMs` pause between batches.
 */
export async function fetchItemsBatched(
  ids: number[],
  batchSize = 20,
  delayMs = 200,
): Promise<AlgoliaRefreshHit[]> {
  if (ids.length === 0) return [];

  const results: AlgoliaRefreshHit[] = [];

  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    const filterStr = chunk.map((id) => `objectID:${id}`).join(" OR ");

    try {
      const params = new URLSearchParams({
        tags: "show_hn",
        filters: filterStr,
        hitsPerPage: String(batchSize),
        attributesToRetrieve: "objectID,points,num_comments",
      });
      const res = await fetch(`${ALGOLIA_SEARCH_BASE}?${params}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        for (const hit of data.hits ?? []) {
          results.push({
            objectID: hit.objectID,
            points: hit.points ?? 0,
            num_comments: hit.num_comments ?? 0,
          });
        }
      }
    } catch {
      // Skip failed batch, continue with rest
    }

    // Delay between batches (skip after last batch)
    if (i + batchSize < ids.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return results;
}
