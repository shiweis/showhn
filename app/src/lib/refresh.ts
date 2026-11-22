/**
 * Data refresh logic for stale post stats (points, comments).
 *
 * Layer 1 (cron): refreshStalePosts() — batched Algolia fetch, called from ingest.ts
 * Layer 2 (on-demand): triggerRefreshIfStale() — fire-and-forget single fetch on post detail view
 */

import { eq, sql } from "drizzle-orm";
import { posts } from "./db/schema";
import type { Post } from "./db/schema";
import { fetchItemsBatched, fetchItemState } from "./hn-api";
import type { AlgoliaRefreshHit, HNItemState } from "./hn-api";
import { parseGitHubRepo, fetchGitHubMeta } from "./fetchers";
import { createRateLimiter } from "./rate-limit";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = BetterSQLite3Database<any>;

const ONE_HOUR = 60 * 60;
const ONE_DAY = 24 * ONE_HOUR;

/** On-demand cooldown: never refresh more often than once per hour */
const ON_DEMAND_COOLDOWN = 1 * ONE_HOUR;

/** Rate limiter for on-demand refresh in the web process: 30 requests/minute */
const onDemandLimiter = createRateLimiter({
  maxTokens: 30,
  refillRate: 30,
  refillIntervalMs: 60_000,
});

// --- Cron refresh (Layer 1) ---

/**
 * Posts refreshed per cron run. The tiers below need about 370 refreshes per
 * 30-minute run at roughly 130 new posts a day (measured Nov 2026). A limit of
 * 100 left posts under a day old 2.5 hours stale on average.
 */
const CRON_REFRESH_LIMIT = 500;

/**
 * How many posts the search did not return are looked up on HN itself per run.
 * Bounded so that a search outage, when nothing comes back, cannot turn one
 * run into hundreds of single-item requests.
 */
export const MISSING_LOOKUPS_PER_RUN = 50;

type RefreshSources = {
  fetchBatch: (ids: number[]) => Promise<AlgoliaRefreshHit[]>;
  fetchState: (id: number) => Promise<HNItemState>;
};

/**
 * Query the DB for post IDs that are stale according to their age tier.
 * Only considers posts ≤ 30 days old. The most overdue come first, measured
 * against the post's own tier, so a new post 40 minutes late outranks a
 * week-old post 30 hours late.
 *
 * Tiers:
 *   < 24h old  → stale after 10 min (in practice: every cron run)
 *   1–3 days   → stale after 1h
 *   3–7 days   → stale after 6h
 *   7–30 days  → stale after 24h
 *   > 30 days  → skipped (on-demand only)
 */
export function getStalePostIds(database: AnyDB, limit = CRON_REFRESH_LIMIT): number[] {
  const now = Math.floor(Date.now() / 1000);

  const result = database.all<{ id: number }>(sql`
    SELECT id FROM (
      SELECT id, ${now} - updated_at AS since_update,
        CASE
          WHEN ${now} - created_at < ${ONE_DAY} THEN ${10 * 60}
          WHEN ${now} - created_at < ${3 * ONE_DAY} THEN ${ONE_HOUR}
          WHEN ${now} - created_at < ${7 * ONE_DAY} THEN ${6 * ONE_HOUR}
          ELSE ${ONE_DAY}
        END AS due_every
      FROM posts
      WHERE status != 'dead' AND created_at >= ${now - 30 * ONE_DAY}
    )
    WHERE since_update > due_every
    ORDER BY since_update * 1.0 / due_every DESC
    LIMIT ${limit}
  `);

  return result.map((r) => r.id);
}

/**
 * Fetch fresh stats for stale posts via batched Algolia queries and update the DB.
 * Called from ingest.ts after the Algolia discovery pass.
 */
export async function refreshStalePosts(
  database: AnyDB,
  limit = CRON_REFRESH_LIMIT,
  sources: RefreshSources = { fetchBatch: fetchItemsBatched, fetchState: fetchItemState },
): Promise<{ refreshed: number; retired: number }> {
  const staleIds = getStalePostIds(database, limit);
  if (staleIds.length === 0) return { refreshed: 0, retired: 0 };

  console.log(`[refresh] Found ${staleIds.length} stale posts to refresh`);

  const hits = await sources.fetchBatch(staleIds);
  const now = Math.floor(Date.now() / 1000);
  const returned = new Set<number>();
  let refreshed = 0;

  for (const hit of hits) {
    const id = parseInt(hit.objectID, 10);
    returned.add(id);
    database
      .update(posts)
      .set({
        points: hit.points,
        comments: hit.num_comments,
        updatedAt: now,
      })
      .where(eq(posts.id, id))
      .run();
    refreshed++;
  }

  // The search drops stories that are dead or deleted on HN. Left alone they
  // stay on the site and sit at the head of the stale list on every run, so
  // ask HN itself about the posts that did not come back.
  const missing = staleIds.filter((id) => !returned.has(id)).slice(0, MISSING_LOOKUPS_PER_RUN);
  let retired = 0;

  for (const id of missing) {
    const item = await sources.fetchState(id);
    if (item.state === "dead" || item.state === "deleted") {
      database.update(posts).set({ status: "dead", updatedAt: now }).where(eq(posts.id, id)).run();
      retired++;
    } else if (item.state === "live") {
      database
        .update(posts)
        .set({ points: item.score, comments: item.descendants, updatedAt: now })
        .where(eq(posts.id, id))
        .run();
      refreshed++;
    }
  }

  console.log(`[refresh] Updated ${refreshed} posts`);
  if (retired > 0) console.log(`[refresh] Retired ${retired} posts that are dead or deleted on HN`);
  return { refreshed, retired };
}

// --- On-demand refresh (Layer 2) ---

/**
 * Fire-and-forget: if the post is stale (updatedAt > 1 hour ago) and the
 * rate limiter allows it, fetch fresh stats from HN Firebase API and update DB.
 *
 * Non-blocking — call without await. The current page render uses existing DB data;
 * the next visitor sees the updated counts.
 */
export function triggerRefreshIfStale(post: Post): void {
  const now = Math.floor(Date.now() / 1000);
  const age = now - (post.updatedAt ?? 0);

  if (age < ON_DEMAND_COOLDOWN) return;
  if (!onDemandLimiter.tryConsume()) return;

  refreshPostOnDemand(post.id).catch(() => {
    // Silently swallow errors — this is best-effort
  });
}

async function refreshPostOnDemand(id: number): Promise<void> {
  const item = await fetchItemState(id);
  if (item.state === "unknown") return;

  const { db } = await import("./db/index");
  const now = Math.floor(Date.now() / 1000);

  if (item.state === "live") {
    db.update(posts)
      .set({
        points: item.score,
        comments: item.descendants,
        updatedAt: now,
      })
      .where(eq(posts.id, id))
      .run();
  } else {
    // Dead or deleted on HN: take it off the site.
    db.update(posts).set({ status: "dead", updatedAt: now }).where(eq(posts.id, id)).run();
  }
}

// --- GitHub metadata refresh (on-demand) ---

/**
 * Fire-and-forget: if the post links to GitHub and metadata is stale (>24h) or missing,
 * fetch fresh stars/language/description from the GitHub API.
 */
export function triggerGitHubRefreshIfStale(post: Post): void {
  if (!post.url) return;
  const ghRepo = parseGitHubRepo(post.url);
  if (!ghRepo) return;

  const now = Math.floor(Date.now() / 1000);
  const age = now - (post.githubUpdatedAt ?? 0);

  if (age < ONE_DAY) return;
  if (!onDemandLimiter.tryConsume()) return;

  refreshGitHubMeta(post.id, ghRepo.owner, ghRepo.repo).catch(() => {});
}

async function refreshGitHubMeta(id: number, owner: string, repo: string): Promise<void> {
  const meta = await fetchGitHubMeta(owner, repo);
  if (!meta) return;

  const { db } = await import("./db/index");
  const now = Math.floor(Date.now() / 1000);

  db.update(posts)
    .set({
      githubStars: meta.stars,
      githubLanguage: meta.language,
      githubDescription: meta.description,
      githubUpdatedAt: now,
    })
    .where(eq(posts.id, id))
    .run();
}
