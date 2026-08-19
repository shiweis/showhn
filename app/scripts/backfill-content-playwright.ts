/**
 * Playwright-based backfill for page_content on JS-rendered sites.
 * Targets non-GitHub posts where plain fetch got < 500 chars.
 *
 * Usage:
 *   npx tsx scripts/backfill-content-playwright.ts
 *   npx tsx scripts/backfill-content-playwright.ts --concurrency 6
 *   npx tsx scripts/backfill-content-playwright.ts --dry-run
 */

import Database from "better-sqlite3";
import { chromium, type Browser } from "playwright";
import path from "path";
import dotenv from "dotenv";
import { installPublicNetworkGuard } from "../src/lib/browser-security";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const concurrencyIdx = args.indexOf("--concurrency");
const CONCURRENCY = concurrencyIdx !== -1 ? parseInt(args[concurrencyIdx + 1], 10) : 4;
const TIMEOUT = 15000;
const VIEWPORT = { width: 1280, height: 800 };

async function extractPageText(browser: Browser, url: string): Promise<string> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    serviceWorkers: "block",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  await installPublicNetworkGuard(context);

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: TIMEOUT });
    try {
      await page.waitForLoadState("networkidle", { timeout: 5000 });
    } catch {
      // networkidle timed out — that's fine
    }
    await page.waitForTimeout(1500);

    const text = await page.innerText("body");
    return text.replace(/\s+/g, " ").trim().slice(0, 5000);
  } catch {
    return "";
  } finally {
    await context.close();
  }
}

async function main() {
  const posts = sqlite.prepare(`
    SELECT id, url, title FROM posts
    WHERE status = 'active'
      AND url IS NOT NULL
      AND url NOT LIKE '%github.com%'
      AND (page_content IS NULL OR LENGTH(page_content) < 500)
    ORDER BY id DESC
  `).all() as { id: number; url: string; title: string }[];

  console.log(`[backfill-pw] ${posts.length} posts need Playwright render`);
  console.log(`[backfill-pw] Concurrency: ${CONCURRENCY}`);

  if (dryRun) {
    console.log("[backfill-pw] Dry run — exiting.");
    return;
  }

  const browser = await chromium.launch();
  console.log("[backfill-pw] Browser launched\n");

  const updateStmt = sqlite.prepare(`UPDATE posts SET page_content = ? WHERE id = ?`);
  let filled = 0;
  let improved = 0;
  let failed = 0;
  let idx = 0;

  async function worker() {
    while (idx < posts.length) {
      const i = idx++;
      const post = posts[i];
      const label = `[${i + 1}/${posts.length}]`;

      const text = await extractPageText(browser, post.url);
      if (text && text.length >= 50) {
        updateStmt.run(text, post.id);
        filled++;
        if (text.length >= 500) improved++;
        console.log(`  ${label} ✓ ${post.id} (${text.length} chars) ${post.title?.slice(0, 50) || post.url}`);
      } else {
        failed++;
        console.log(`  ${label} ✗ ${post.id} (${text.length} chars) ${post.url}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, posts.length) }, () => worker());
  await Promise.all(workers);

  await browser.close();

  console.log(`\n[backfill-pw] Done: ${filled} filled (${improved} now 500+ chars), ${failed} still empty/thin`);

  // Final stats
  const stats = sqlite.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN page_content IS NOT NULL AND LENGTH(page_content) >= 500 THEN 1 ELSE 0 END) as good,
      SUM(CASE WHEN page_content IS NOT NULL AND LENGTH(page_content) BETWEEN 1 AND 499 THEN 1 ELSE 0 END) as thin,
      SUM(CASE WHEN page_content IS NULL OR page_content = '' THEN 1 ELSE 0 END) as empty
    FROM posts WHERE status = 'active'
  `).get() as { total: number; good: number; thin: number; empty: number };

  console.log(`[backfill-pw] Overall: ${stats.good} good (500+), ${stats.thin} thin (<500), ${stats.empty} empty`);
}

main().catch((err) => {
  console.error("[backfill-pw] Fatal:", err);
  process.exit(1);
});
