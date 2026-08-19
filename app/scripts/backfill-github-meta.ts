/**
 * Backfill GitHub metadata (stars, language, description) for existing posts.
 * Uses the GitHub API — requires GITHUB_TOKEN for rate limits (5000 req/hr with token vs 60 without).
 *
 * Usage:
 *   npx tsx scripts/backfill-github-meta.ts              # backfill all missing
 *   npx tsx scripts/backfill-github-meta.ts --concurrency 10
 *   npx tsx scripts/backfill-github-meta.ts --dry-run     # just count what's missing
 */

import Database from "better-sqlite3";
import { parseGitHubRepo, fetchGitHubMeta } from "../src/lib/fetchers";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const concurrencyIdx = args.indexOf("--concurrency");
const CONCURRENCY = concurrencyIdx !== -1 ? parseInt(args[concurrencyIdx + 1], 10) : 10;

// Ensure columns exist
for (const col of ["github_stars INTEGER", "github_language TEXT", "github_description TEXT", "github_updated_at INTEGER"]) {
  try { sqlite.exec(`ALTER TABLE posts ADD COLUMN ${col}`); } catch { /* exists */ }
}

async function runParallel<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    console.warn("[backfill] WARNING: No GITHUB_TOKEN set — unauthenticated rate limit is 60 req/hr.");
    console.warn("[backfill] Set GITHUB_TOKEN in .env.local for 5000 req/hr.\n");
  }

  const needsMeta = sqlite
    .prepare(`SELECT id, url FROM posts WHERE url LIKE 'https://github.com/%' AND github_stars IS NULL AND status = 'active'`)
    .all() as { id: number; url: string }[];

  console.log(`[backfill] ${needsMeta.length} GitHub posts missing metadata`);
  console.log(`[backfill] Concurrency: ${CONCURRENCY}`);

  if (dryRun) {
    console.log("[backfill] Dry run — exiting.");
    return;
  }

  if (needsMeta.length === 0) {
    console.log("[backfill] Nothing to do.");
    return;
  }

  const updateStmt = sqlite.prepare(
    `UPDATE posts SET github_stars = ?, github_language = ?, github_description = ?, github_updated_at = ? WHERE id = ?`
  );
  let filled = 0;
  let failed = 0;

  await runParallel(needsMeta, CONCURRENCY, async (post) => {
    const ghRepo = parseGitHubRepo(post.url);
    if (!ghRepo) { failed++; return; }

    const meta = await fetchGitHubMeta(ghRepo.owner, ghRepo.repo);
    if (meta) {
      const now = Math.floor(Date.now() / 1000);
      updateStmt.run(meta.stars, meta.language, meta.description, now, post.id);
      filled++;
    } else {
      failed++;
    }

    const total = filled + failed;
    if (total % 50 === 0) {
      console.log(`  [meta] ${total}/${needsMeta.length} (${filled} filled, ${failed} failed)`);
    }
  });

  console.log(`[backfill] Done: ${filled} filled, ${failed} failed out of ${needsMeta.length}`);

  const stats = sqlite.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN url LIKE 'https://github.com/%' THEN 1 ELSE 0 END) as github_total,
      SUM(CASE WHEN github_stars IS NOT NULL THEN 1 ELSE 0 END) as has_meta
    FROM posts
  `).get() as { total: number; github_total: number; has_meta: number };

  console.log(`\n[backfill] Final: ${stats.has_meta}/${stats.github_total} GitHub posts have metadata (${stats.total} total posts)`);
}

main().catch((err) => {
  console.error("[backfill] Fatal:", err);
  process.exit(1);
});
