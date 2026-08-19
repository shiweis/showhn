/**
 * Re-enqueue tasks for reprocessing.
 * Useful when you update the AI model/prompt or need to retake screenshots.
 *
 * The default task type is "process" (combined screenshot + AI analysis).
 * Use "analyze" only for posts without URLs (text-only Show HNs).
 *
 * Usage:
 *   npx tsx scripts/requeue.ts process                    # posts without analysis (screenshot + AI)
 *   npx tsx scripts/requeue.ts process --all              # all posts (reprocess everything)
 *   npx tsx scripts/requeue.ts process --model gpt-4o-mini  # posts analyzed with a specific model
 *   npx tsx scripts/requeue.ts process --before 2025-01-01  # posts analyzed before a date
 *   npx tsx scripts/requeue.ts process --post 12345 67890   # specific post IDs
 *   npx tsx scripts/requeue.ts analyze                    # text-only posts without analysis
 *   npx tsx scripts/requeue.ts analyze --all              # all text-only posts
 *   npx tsx scripts/requeue.ts --stats                    # show queue stats
 *
 * Legacy aliases: "screenshot" is treated as "process" (combined pipeline).
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, and, isNull, sql, lte } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { bulkEnqueue, getQueueStats, type TaskType } from "../src/lib/queue";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

const DB_PATH =
  process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
const db = drizzle(sqlite, { schema });

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: Record<string, string | boolean | string[]> = {};
  let taskType: string | undefined;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--all") {
      flags.all = true;
    } else if (arg === "--failed") {
      flags.failed = true;
    } else if (arg === "--stats") {
      flags.stats = true;
    } else if (arg === "--model" && args[i + 1]) {
      flags.model = args[++i];
    } else if (arg === "--before" && args[i + 1]) {
      flags.before = args[++i];
    } else if (arg === "--priority" && args[i + 1]) {
      flags.priority = args[++i];
    } else if (arg === "--post") {
      // Collect all following numeric args as post IDs
      const postIds: string[] = [];
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        postIds.push(args[++i]);
      }
      flags.post = postIds;
    } else if (!arg.startsWith("--")) {
      taskType = arg;
    }
    i++;
  }

  return { taskType, flags };
}

function showStats() {
  const stats = getQueueStats(db);
  console.log("[requeue] Queue stats:");
  if (Object.keys(stats).length === 0) {
    console.log("  (empty)");
    return;
  }
  for (const [key, count] of Object.entries(stats)) {
    console.log(`  ${key}: ${count}`);
  }
}

function getPostIdsForAnalyze(flags: Record<string, string | boolean | string[]>): number[] {
  // Analyze-only is for text posts (no URL) — these can't take screenshots
  const noUrlFilter = sql`${schema.posts.url} IS NULL`;

  if (flags.post) {
    return (flags.post as string[]).map(Number).filter((n) => !isNaN(n));
  }

  if (flags.all) {
    // All text-only posts
    return db
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(noUrlFilter)
      .all()
      .map((r) => r.id);
  }

  if (flags.failed) {
    // Re-enqueue failed analyze tasks
    return db
      .select({ postId: schema.taskQueue.postId })
      .from(schema.taskQueue)
      .where(
        and(
          eq(schema.taskQueue.type, "analyze"),
          eq(schema.taskQueue.status, "failed")
        )
      )
      .all()
      .map((r) => r.postId);
  }

  // Default: text-only posts without any analysis
  return db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .leftJoin(schema.aiAnalysis, eq(schema.posts.id, schema.aiAnalysis.postId))
    .where(and(noUrlFilter, isNull(schema.aiAnalysis.postId)))
    .all()
    .map((r) => r.id);
}

function getPostIdsForProcess(flags: Record<string, string | boolean | string[]>): number[] {
  if (flags.post) {
    return (flags.post as string[]).map(Number).filter((n) => !isNaN(n));
  }

  if (flags.all) {
    // All posts with URLs (reprocess everything)
    return db
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(
        and(
          eq(schema.posts.status, "active"),
          sql`${schema.posts.url} IS NOT NULL`
        )
      )
      .all()
      .map((r) => r.id);
  }

  if (flags.model) {
    // Posts analyzed with a specific model
    return db
      .select({ id: schema.aiAnalysis.postId })
      .from(schema.aiAnalysis)
      .innerJoin(schema.posts, eq(schema.posts.id, schema.aiAnalysis.postId))
      .where(
        and(
          eq(schema.aiAnalysis.model, flags.model as string),
          sql`${schema.posts.url} IS NOT NULL`
        )
      )
      .all()
      .map((r) => r.id);
  }

  if (flags.before) {
    // Posts analyzed before a date
    const cutoff = Math.floor(new Date(flags.before as string).getTime() / 1000);
    if (isNaN(cutoff)) {
      console.error(`[requeue] Invalid date: ${flags.before}`);
      process.exit(1);
    }
    return db
      .select({ id: schema.aiAnalysis.postId })
      .from(schema.aiAnalysis)
      .innerJoin(schema.posts, eq(schema.posts.id, schema.aiAnalysis.postId))
      .where(
        and(
          lte(schema.aiAnalysis.analyzedAt, cutoff),
          sql`${schema.posts.url} IS NOT NULL`
        )
      )
      .all()
      .map((r) => r.id);
  }

  if (flags.failed) {
    // Re-enqueue failed process/screenshot tasks
    return db
      .select({ postId: schema.taskQueue.postId })
      .from(schema.taskQueue)
      .where(
        and(
          sql`${schema.taskQueue.type} IN ('process', 'screenshot')`,
          eq(schema.taskQueue.status, "failed")
        )
      )
      .all()
      .map((r) => r.postId);
  }

  // Default: posts with URLs that are missing analysis or new fields
  return db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .leftJoin(schema.aiAnalysis, eq(schema.posts.id, schema.aiAnalysis.postId))
    .where(
      and(
        eq(schema.posts.status, "active"),
        sql`${schema.posts.url} IS NOT NULL`,
        sql`(${schema.aiAnalysis.postId} IS NULL OR ${schema.aiAnalysis.pickScore} IS NULL)`
      )
    )
    .all()
    .map((r) => r.id);
}

function main() {
  const { taskType, flags } = parseArgs();

  if (flags.stats) {
    showStats();
    return;
  }

  // Default to "process" if no type given; treat "screenshot" as "process" (legacy alias)
  const resolvedType = !taskType ? "process" : taskType === "screenshot" ? "process" : taskType;

  if (!["process", "analyze"].includes(resolvedType)) {
    console.error("Usage: npx tsx scripts/requeue.ts [process|analyze] [options]");
    console.error("       npx tsx scripts/requeue.ts --stats");
    console.error("");
    console.error("Options:");
    console.error("  --all              Reprocess all posts");
    console.error("  --failed           Retry failed tasks");
    console.error("  --model <name>     Posts analyzed with specific model");
    console.error("  --before <date>    Posts analyzed before date");
    console.error("  --post <id> ...    Specific post IDs");
    console.error("  --priority <n>     Task priority (default 0, higher = processed sooner)");
    console.error("  --stats            Show queue statistics");
    console.error("");
    console.error("Task types:");
    console.error("  process            Combined screenshot + AI analysis (default)");
    console.error("  analyze            AI analysis only (for text-only posts without URLs)");
    process.exit(1);
  }

  // For "process" tasks, use the same filters as analyze but enqueue as "process"
  // For "analyze", only target posts without URLs
  const type = resolvedType as TaskType;
  const priority = flags.priority ? parseInt(flags.priority as string, 10) : 0;

  let postIds: number[];
  if (type === "analyze") {
    // Analyze-only: text posts without URLs
    postIds = getPostIdsForAnalyze({ ...flags, noUrl: true });
  } else {
    // Process (combined): posts with URLs
    postIds = getPostIdsForProcess(flags);
  }

  if (postIds.length === 0) {
    console.log(`[requeue] No posts to enqueue for ${type}`);
    return;
  }

  console.log(`[requeue] Enqueuing ${postIds.length} ${type} tasks (priority=${priority})...`);
  const enqueued = bulkEnqueue(db, type, postIds, priority);
  console.log(`[requeue] Done. ${enqueued} tasks enqueued (${postIds.length - enqueued} already pending).`);
}

main();
