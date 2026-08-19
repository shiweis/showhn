/**
 * Takes screenshots of Show HN project URLs using Playwright.
 * Run: npx tsx scripts/screenshot.ts
 * Processes posts that have a URL but no screenshot yet.
 * Pass --limit N to cap the number of screenshots per run.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, and, isNotNull } from "drizzle-orm";
import { chromium, type Browser } from "playwright";
import * as schema from "../src/lib/db/schema";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { installPublicNetworkGuard } from "../src/lib/browser-security";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
const db = drizzle(sqlite, { schema });

const SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");
const CONCURRENCY = parseInt(process.env.SCREENSHOT_CONCURRENCY || "4", 10);
const TIMEOUT = parseInt(process.env.SCREENSHOT_TIMEOUT || "15000", 10);
const VIEWPORT = { width: 1280, height: 800 };

function getLimit(): number {
  const idx = process.argv.indexOf("--limit");
  if (idx !== -1 && process.argv[idx + 1]) {
    return parseInt(process.argv[idx + 1], 10);
  }
  return 0; // 0 = no limit
}

async function takeScreenshot(
  browser: Browser,
  postId: number,
  url: string
): Promise<boolean> {
  const screenshotPath = path.join(SCREENSHOT_DIR, `${postId}.webp`);

  const context = await browser.newContext({
    viewport: VIEWPORT,
    serviceWorkers: "block",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  await installPublicNetworkGuard(context);

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    // Wait for page to settle — domcontentloaded is more reliable than networkidle
    // (GitHub/SPAs keep connections open that prevent networkidle from firing)
    await page.waitForTimeout(2000);

    const temporaryPath = `${screenshotPath}.tmp.png`;
    await page.screenshot({
      path: temporaryPath,
      type: "png",
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });
    try {
      await sharp(temporaryPath).webp({ quality: 85 }).toFile(screenshotPath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }

    return true;
  } catch (err) {
    console.error(`  [screenshot] Failed for post ${postId} (${url}):`, (err as Error).message);
    return false;
  } finally {
    await context.close();
  }
}

async function processPost(
  browser: Browser,
  post: { id: number; url: string },
  retries = 1
): Promise<void> {
  let success = await takeScreenshot(browser, post.id, post.url);

  if (!success && retries > 0) {
    console.log(`  [screenshot] Retrying post ${post.id}...`);
    await new Promise((r) => setTimeout(r, 2000));
    success = await takeScreenshot(browser, post.id, post.url);
  }

  if (success) {
    db.update(schema.posts)
      .set({ hasScreenshot: 1 })
      .where(eq(schema.posts.id, post.id))
      .run();
    console.log(`  [screenshot] ✓ Post ${post.id}`);
  } else {
    db.update(schema.posts)
      .set({ status: "dead" })
      .where(eq(schema.posts.id, post.id))
      .run();
    console.log(`  [screenshot] ✗ Post ${post.id} marked as dead`);
  }
}

async function run() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const limit = getLimit();

  // Get posts that have a URL but no screenshot
  const query = db
    .select({ id: schema.posts.id, url: schema.posts.url })
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.hasScreenshot, 0),
        eq(schema.posts.status, "active"),
        isNotNull(schema.posts.url)
      )
    )
    .orderBy(schema.posts.createdAt);

  const pending = limit > 0
    ? query.limit(limit).all()
    : query.all();

  console.log(`[screenshot] ${pending.length} posts need screenshots`);
  if (pending.length === 0) return;

  const browser = await chromium.launch();

  // Process in batches of CONCURRENCY
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    console.log(
      `[screenshot] Batch ${Math.floor(i / CONCURRENCY) + 1}: posts ${batch.map((p) => p.id).join(", ")}`
    );
    await Promise.all(
      batch.map((post) =>
        processPost(browser, post as { id: number; url: string })
      )
    );
  }

  await browser.close();
  console.log("[screenshot] Done.");
}

run().catch((err) => {
  console.error("[screenshot] Fatal error:", err);
  process.exit(1);
});
