/**
 * SQLite-backed task queue for processing screenshots and AI analysis.
 * Uses the task_queue table with transactional dequeue for atomic task claiming.
 */

import { eq, and, sql, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema";

type DB = BetterSQLite3Database<typeof schema>;

export type TaskType = "screenshot" | "analyze" | "process";

/**
 * Transactions here read rows and then write them. Started the default way,
 * such a transaction fails with SQLITE_BUSY_SNAPSHOT ("database is locked")
 * when another process commits between the read and the write, and SQLite
 * cannot retry it. Taking the write lock up front makes it wait its turn.
 */
const WRITE_LOCK_FIRST = { behavior: "immediate" } as const;

/**
 * Enqueue a new task for a post.
 * Skips if an identical pending/processing task already exists unless force=true.
 */
export function enqueueTask(
  db: DB,
  type: TaskType,
  postId: number,
  priority = 0,
  force = false
): void {
  if (!force) {
    const existing = db
      .select({ id: schema.taskQueue.id })
      .from(schema.taskQueue)
      .where(
        and(
          eq(schema.taskQueue.type, type),
          eq(schema.taskQueue.postId, postId),
          sql`${schema.taskQueue.status} IN ('pending', 'processing')`
        )
      )
      .get();

    if (existing) return;
  }

  const now = Math.floor(Date.now() / 1000);
  db.insert(schema.taskQueue)
    .values({
      type,
      postId,
      status: "pending",
      priority,
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
    })
    .run();
}

/**
 * Enqueue a combined process task (screenshot + analysis) for a post,
 * or just analyze for text-only posts.
 */
export function enqueuePostTasks(
  db: DB,
  postId: number,
  hasUrl: boolean,
  priority = 0,
  force = false
): void {
  if (hasUrl) {
    enqueueTask(db, "process", postId, priority, force);
  } else {
    enqueueTask(db, "analyze", postId, priority, force);
  }
}

/**
 * Bulk enqueue a task type for multiple post IDs.
 * Used for reprocessing (e.g., after model/prompt change).
 */
export function bulkEnqueue(
  db: DB,
  type: TaskType,
  postIds: number[],
  priority = 0
): number {
  let count = 0;
  const now = Math.floor(Date.now() / 1000);

  db.transaction((tx) => {
    for (const postId of postIds) {
      // Skip if already pending/processing
      const existing = tx
        .select({ id: schema.taskQueue.id })
        .from(schema.taskQueue)
        .where(
          and(
            eq(schema.taskQueue.type, type),
            eq(schema.taskQueue.postId, postId),
            sql`${schema.taskQueue.status} IN ('pending', 'processing')`
          )
        )
        .get();

      if (existing) continue;

      tx.insert(schema.taskQueue)
        .values({
          type,
          postId,
          status: "pending",
          priority,
          attempts: 0,
          maxAttempts: 3,
          createdAt: now,
        })
        .run();
      count++;
    }
  }, WRITE_LOCK_FIRST);

  return count;
}

/**
 * Atomically claim the next pending task of the given type.
 */
export function dequeueTask(
  db: DB,
  type?: TaskType
): schema.TaskQueue | null {
  const now = Math.floor(Date.now() / 1000);

  // Use a transaction with SELECT + UPDATE for atomic claim.
  const task = db.transaction((tx) => {
    const rows = tx
      .select()
      .from(schema.taskQueue)
      .where(
        and(
          eq(schema.taskQueue.status, "pending"),
          ...(type ? [eq(schema.taskQueue.type, type)] : [])
        )
      )
      .orderBy(
        sql`${schema.taskQueue.priority} DESC`,
        // Untried work first, so a task that keeps failing cannot hold up the queue.
        sql`${schema.taskQueue.attempts} ASC`,
        sql`${schema.taskQueue.createdAt} ASC`
      )
      .limit(1)
      .all();

    if (rows.length === 0) return null;

    const task = rows[0];
    tx.update(schema.taskQueue)
      .set({
        status: "processing",
        startedAt: now,
        attempts: (task.attempts ?? 0) + 1,
      })
      .where(eq(schema.taskQueue.id, task.id))
      .run();

    return { ...task, status: "processing" as const, startedAt: now, attempts: (task.attempts ?? 0) + 1 };
  }, WRITE_LOCK_FIRST);

  return task;
}

/**
 * Atomically claim up to batchSize pending tasks.
 */
export function dequeueBatch(
  db: DB,
  batchSize: number,
  type?: TaskType
): schema.TaskQueue[] {
  const now = Math.floor(Date.now() / 1000);

  return db.transaction((tx) => {
    const rows = tx
      .select()
      .from(schema.taskQueue)
      .where(
        and(
          eq(schema.taskQueue.status, "pending"),
          ...(type ? [eq(schema.taskQueue.type, type)] : [])
        )
      )
      .orderBy(
        sql`${schema.taskQueue.priority} DESC`,
        // Untried work first, so a task that keeps failing cannot hold up the queue.
        sql`${schema.taskQueue.attempts} ASC`,
        sql`${schema.taskQueue.createdAt} ASC`
      )
      .limit(batchSize)
      .all();

    if (rows.length === 0) return [];

    const claimed: schema.TaskQueue[] = [];
    for (const task of rows) {
      tx.update(schema.taskQueue)
        .set({
          status: "processing",
          startedAt: now,
          attempts: (task.attempts ?? 0) + 1,
        })
        .where(eq(schema.taskQueue.id, task.id))
        .run();

      claimed.push({
        ...task,
        status: "processing" as const,
        startedAt: now,
        attempts: (task.attempts ?? 0) + 1,
      });
    }

    return claimed;
  }, WRITE_LOCK_FIRST);
}

/**
 * Mark a task as completed.
 */
export function completeTask(db: DB, taskId: number): void {
  const now = Math.floor(Date.now() / 1000);
  db.update(schema.taskQueue)
    .set({ status: "completed", completedAt: now, error: null })
    .where(eq(schema.taskQueue.id, taskId))
    .run();
}

/**
 * Mark a task as failed. Re-queues as pending if under max attempts.
 */
export function failTask(db: DB, taskId: number, error: string): void {
  const now = Math.floor(Date.now() / 1000);
  const safeError = error.replace(/\s+/g, " ").slice(0, 2000);
  const task = db
    .select()
    .from(schema.taskQueue)
    .where(eq(schema.taskQueue.id, taskId))
    .get();

  if (!task) return;

  const attempts = task.attempts ?? 0;
  const maxAttempts = task.maxAttempts ?? 3;

  if (attempts >= maxAttempts) {
    db.update(schema.taskQueue)
      .set({ status: "failed", completedAt: now, error: safeError })
      .where(eq(schema.taskQueue.id, taskId))
      .run();
  } else {
    // Re-queue for retry
    db.update(schema.taskQueue)
      .set({ status: "pending", startedAt: null, error: safeError })
      .where(eq(schema.taskQueue.id, taskId))
      .run();
  }
}

/**
 * Return a claimed task to the queue without it costing an attempt. For
 * interruptions that say nothing about the task itself: the worker is shutting
 * down, or the provider is unavailable. A task that is no longer being
 * processed (already completed or failed) is left alone.
 */
export function releaseTask(db: DB, taskId: number, reason: string): void {
  const safeReason = reason.replace(/\s+/g, " ").slice(0, 2000);
  db.update(schema.taskQueue)
    .set({
      status: "pending",
      startedAt: null,
      attempts: sql`max(coalesce(${schema.taskQueue.attempts}, 0) - 1, 0)`,
      error: safeReason,
    })
    .where(and(eq(schema.taskQueue.id, taskId), eq(schema.taskQueue.status, "processing")))
    .run();
}

/**
 * Reclaim stale processing tasks (worker crashed).
 * Tasks stuck in "processing" for longer than timeoutSeconds are reset to "pending".
 */
export function reclaimStaleTasks(db: DB, timeoutSeconds = 300): number {
  const cutoff = Math.floor(Date.now() / 1000) - timeoutSeconds;

  // The dequeue that stranded a task already counted its attempt, so a reclaim
  // adds none. A task that strands the worker on every attempt still runs out.
  const staleTasks = db
    .select()
    .from(schema.taskQueue)
    .where(
      and(
        eq(schema.taskQueue.status, "processing"),
        lte(schema.taskQueue.startedAt, cutoff)
      )
    )
    .all();

  let reclaimed = 0;
  for (const task of staleTasks) {
    const attempts = task.attempts ?? 0;
    const maxAttempts = task.maxAttempts ?? 3;

    if (attempts >= maxAttempts) {
      db.update(schema.taskQueue)
        .set({ status: "failed", completedAt: Math.floor(Date.now() / 1000), error: "exceeded max attempts (stale reclaim)" })
        .where(eq(schema.taskQueue.id, task.id))
        .run();
    } else {
      db.update(schema.taskQueue)
        .set({ status: "pending", startedAt: null })
        .where(eq(schema.taskQueue.id, task.id))
        .run();
    }
    reclaimed++;
  }

  return reclaimed;
}

/**
 * Get counts of tasks by status and type.
 */
export function getQueueStats(db: DB): Record<string, number> {
  const rows = db
    .select({
      type: schema.taskQueue.type,
      status: schema.taskQueue.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.taskQueue)
    .groupBy(schema.taskQueue.type, schema.taskQueue.status)
    .all();

  const stats: Record<string, number> = {};
  for (const row of rows) {
    stats[`${row.type}_${row.status}`] = row.count;
  }
  return stats;
}
