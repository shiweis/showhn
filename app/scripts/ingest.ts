/**
 * Ingests Show HN posts from the Algolia HN API into SQLite.
 * Run: npx tsx scripts/ingest.ts
 * Cron: run hourly to pick up new posts.
 * Pass --backfill to fetch the last 30 days.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { enqueuePostTasks } from "../src/lib/queue";
import { refreshStalePosts } from "../src/lib/refresh";
import { syncPostToFts } from "../src/lib/db/fts";
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
  nbPages: number;
  page: number;
}

async function fetchPage(page: number, startTimestamp?: number): Promise<AlgoliaResponse> {
  const params = new URLSearchParams({
    tags: "show_hn",
    hitsPerPage: String(HITS_PER_PAGE),
    page: String(page),
  });
  if (startTimestamp) {
    params.set("numericFilters", `created_at_i>${startTimestamp}`);
  }

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

function upsertPost(hit: AlgoliaHit) {
  const now = Math.floor(Date.now() / 1000);
  const id = parseInt(hit.objectID, 10);

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
    enqueuePostTasks(db, id, hasUrl, 10);
  }

  syncPostToFts(sqlite, id);

  return !existing;
}

async function ingest(backfill = false) {
  // For backfill: go back 30 days. For hourly: go back 2 hours (with overlap).
  const lookbackSeconds = backfill ? 30 * 24 * 60 * 60 : 2 * 60 * 60;
  const startTimestamp = Math.floor(Date.now() / 1000) - lookbackSeconds;

  console.log(
    `[ingest] Starting ${backfill ? "backfill (30 days)" : "hourly"} ingestion...`
  );
  console.log(`[ingest] Fetching posts since ${new Date(startTimestamp * 1000).toISOString()}`);

  let page = 0;
  let totalFetched = 0;
  let newPosts = 0;

  while (true) {
    const data = await fetchPage(page, startTimestamp);
    if (data.hits.length === 0) break;

    for (const hit of data.hits) {
      const isNew = upsertPost(hit);
      if (isNew) newPosts++;
      totalFetched++;
    }

    console.log(`[ingest] Page ${page + 1}: ${data.hits.length} hits (${newPosts} new so far)`);

    page++;
    if (page >= data.nbPages) break;

    // Rate limit: be nice to Algolia
    await new Promise((r) => setTimeout(r, 200));
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
