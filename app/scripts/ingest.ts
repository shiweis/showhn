/**
 * Ingests Show HN posts from the Algolia HN API into SQLite.
 * Run: npx tsx scripts/ingest.ts
 * Cron: runs every 30 minutes and resumes from the newest post already stored.
 * Pass --backfill to re-read the last 30 days, or --since <date> [--until <date>]
 * to re-read a chosen stretch (dates are UTC, for example 2026-08-23).
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { enqueuePostTasks } from "../src/lib/queue";
import { refreshStalePosts } from "../src/lib/refresh";
import { syncPostToFts } from "../src/lib/db/fts";
import { parseRemovedPostIds } from "../src/lib/removed-posts";
import { ingestWindows, resumeFrom } from "../src/lib/ingest-window";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

const ALGOLIA_BASE = "https://hn.algolia.com/api/v1/search_by_date";
const HITS_PER_PAGE = 100;

// Author-requested removals must stay removed even if Algolia returns them again.
// The ids are kept out of the repository, in REMOVED_POST_IDS in .env.local.
const REMOVED_POST_IDS = parseRemovedPostIds(process.env.REMOVED_POST_IDS);

interface AlgoliaHit {
  objectID: string;
  title: string;
  url: string | null;
  author: string;
  points: number;
  num_comments: number;
  created_at_i: number;
  story_text: string | null;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbHits: number;
  nbPages: number;
  page: number;
}

/** One page of Show HN posts created after `from` and up to `to` (unix seconds). */
async function fetchPage(page: number, from: number, to: number): Promise<AlgoliaResponse> {
  const params = new URLSearchParams({
    tags: "show_hn",
    hitsPerPage: String(HITS_PER_PAGE),
    page: String(page),
    numericFilters: `created_at_i>${from},created_at_i<=${to}`,
  });

  const url = `${ALGOLIA_BASE}?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Algolia API error: ${res.status}`);
  return res.json();
}

/**
 * Extract the first http(s) URL from HN story_text (which uses <p>, <a> tags
 * and HTML entities like &#x2F; for /). Skips HN internal links.
 */
function extractUrlFromText(storyText: string | null): string | null {
  if (!storyText) return null;
  // Decode HTML entities first
  const decoded = storyText
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"');
  // Extract href values first (most reliable), then fall back to bare URLs
  const hrefRegex = /href="(https?:\/\/[^"]+)"/gi;
  let match;
  while ((match = hrefRegex.exec(decoded)) !== null) {
    const url = match[1].replace(/[.,;:)\]]+$/, "");
    if (!url.includes("news.ycombinator.com")) return url;
  }
  // Fallback: bare URLs
  const urlRegex = /https?:\/\/[^\s<>"]+/gi;
  const matches = decoded.match(urlRegex);
  if (!matches) return null;
  for (const url of matches) {
    if (url.includes("news.ycombinator.com")) continue;
    return url.replace(/[.,;:)\]]+$/, "");
  }
  return null;
}

function upsertPost(hit: AlgoliaHit, newPostPriority: number) {
  const now = Math.floor(Date.now() / 1000);
  const id = parseInt(hit.objectID, 10);
  if (REMOVED_POST_IDS.has(id)) return false;

  // If no URL field, try to extract from story_text
  const resolvedUrl = hit.url || extractUrlFromText(hit.story_text);

  const existing = db.select().from(schema.posts).where(eq(schema.posts.id, id)).get();

  if (existing) {
    // Update points/comments; also fill in URL if we found one and it was missing
    const updates: Record<string, unknown> = {
      points: hit.points,
      comments: hit.num_comments,
      updatedAt: now,
    };
    if (!existing.url && resolvedUrl) {
      updates.url = resolvedUrl;
      updates.status = "active";
    }
    db.update(schema.posts)
      .set(updates)
      .where(eq(schema.posts.id, id))
      .run();
    // If we just resolved a URL for a previously no_url post, enqueue tasks
    if (!existing.url && resolvedUrl) {
      enqueuePostTasks(db, id, true, 5);
    }
  } else {
    const hasUrl = !!resolvedUrl;
    db.insert(schema.posts)
      .values({
        id,
        title: hit.title,
        url: resolvedUrl || null,
        author: hit.author,
        points: hit.points,
        comments: hit.num_comments,
        createdAt: hit.created_at_i,
        storyText: hit.story_text || null,
        hasScreenshot: 0,
        status: hasUrl ? "active" : "no_url",
        fetchedAt: now,
        updatedAt: now,
      })
      .run();

    // Enqueue screenshot + analysis tasks for the worker to pick up
    // New posts get higher priority so they're processed before backfill
    enqueuePostTasks(db, id, hasUrl, newPostPriority);
  }

  syncPostToFts(sqlite, id);

  return !existing;
}

const DAY = 24 * 60 * 60;
/** The search returns at most this many hits for one query, however many pages are asked for. */
const MAX_HITS_PER_QUERY = 1000;

/** Read a date argument such as `--since 2026-08-23` (UTC) as unix seconds. */
function dateArgument(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  const ms = Date.parse(value ?? "");
  if (Number.isNaN(ms)) throw new Error(`${name} needs a date such as 2026-08-23, got "${value}"`);
  return Math.floor(ms / 1000);
}

/** Ingest every Show HN post created after `from` and up to `to`. */
async function ingestRange(
  from: number,
  to: number,
  newPostPriority: number,
): Promise<{ fetched: number; added: number }> {
  let page = 0;
  let fetched = 0;
  let added = 0;

  while (true) {
    const data = await fetchPage(page, from, to);

    // More posts than one query can return: read the range as two halves instead.
    if (page === 0 && data.nbHits > MAX_HITS_PER_QUERY && to - from > 60) {
      const middle = from + Math.floor((to - from) / 2);
      const older = await ingestRange(from, middle, newPostPriority);
      const newer = await ingestRange(middle, to, newPostPriority);
      return { fetched: older.fetched + newer.fetched, added: older.added + newer.added };
    }

    if (data.hits.length === 0) break;

    for (const hit of data.hits) {
      if (upsertPost(hit, newPostPriority)) added++;
      fetched++;
    }

    page++;
    if (page >= data.nbPages) break;

    // Rate limit: be nice to Algolia
    await new Promise((r) => setTimeout(r, 200));
  }

  return { fetched, added };
}

/**
 * A regular run resumes from the newest post already stored (see resumeFrom).
 * `--backfill` re-reads the last 30 days; `--since <date>` and `--until <date>`
 * re-read a chosen stretch. Either way the range is read a day at a time, so
 * the search's 1,000-hit ceiling no longer cuts a long range short.
 */
async function ingest(backfill = false) {
  const now = Math.floor(Date.now() / 1000);
  const since = dateArgument("--since");
  const until = dateArgument("--until");
  const catchingUp = backfill || since !== undefined;

  const newestStoredAt = sqlite.prepare("SELECT max(created_at) FROM posts").pluck().get() as number | null;
  const startTimestamp = since ?? (backfill ? now - 30 * DAY : resumeFrom(newestStoredAt, now));
  const endTimestamp = until ?? now;
  // Posts found by a catch-up run are old news: let fresh posts be judged first.
  const newPostPriority = catchingUp ? 0 : 10;

  console.log(`[ingest] Starting ${catchingUp ? "catch-up" : "regular"} ingestion...`);
  console.log(
    `[ingest] Fetching posts since ${new Date(startTimestamp * 1000).toISOString()}` +
      (until !== undefined ? ` until ${new Date(endTimestamp * 1000).toISOString()}` : ""),
  );
  console.log(`[ingest] Author-removed posts kept out: ${REMOVED_POST_IDS.size}`);

  let totalFetched = 0;
  let newPosts = 0;
  const windows = ingestWindows(startTimestamp, endTimestamp);

  for (const window of windows) {
    const { fetched, added } = await ingestRange(window.from, window.to, newPostPriority);
    totalFetched += fetched;
    newPosts += added;
    if (windows.length > 1) {
      console.log(`[ingest] ${new Date(window.from * 1000).toISOString().slice(0, 16)}Z onward: ${fetched} hits (${newPosts} new so far)`);
    }
  }

  console.log(`[ingest] Done. Fetched ${totalFetched} posts, ${newPosts} new.`);

  // Refresh stale posts via batched Algolia objectID queries
  const { refreshed } = await refreshStalePosts(db);
  console.log(`[ingest] Refreshed ${refreshed} stale posts.`);
}

const isBackfill = process.argv.includes("--backfill");
ingest(isBackfill).catch((err) => {
  console.error("[ingest] Fatal error:", err);
  process.exit(1);
});
