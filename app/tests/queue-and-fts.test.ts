import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/lib/db/schema";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bulkEnqueue,
  completeTask,
  dequeueBatch,
  dequeueTask,
  enqueueTask,
  failTask,
  isLastAttempt,
  postIdsWithUnresolvedFailure,
  reclaimStaleTasks,
  releaseTask,
} from "../src/lib/queue";
import { syncPostToFts } from "../src/lib/db/fts";

function createDatabase(file = ":memory:", options: Database.Options = {}) {
  const sqlite = new Database(file, options);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT,
      author TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      fetched_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE ai_analysis (
      post_id INTEGER PRIMARY KEY,
      summary TEXT,
      analyzed_at INTEGER NOT NULL,
      model TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id)
    );
    CREATE TABLE task_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      post_id INTEGER NOT NULL REFERENCES posts(id),
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT
    );
  `);
  sqlite.prepare("INSERT INTO posts(id,title,author,created_at,fetched_at,updated_at) VALUES (1,'Widget engine','maker',1,1,1)").run();
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

test("queue deduplicates, retries, and completes tasks", () => {
  const { sqlite, db } = createDatabase();
  try {
    enqueueTask(db, "analyze", 1);
    enqueueTask(db, "analyze", 1);
    assert.equal(sqlite.prepare("SELECT count(*) FROM task_queue").pluck().get(), 1);

    const first = dequeueTask(db)!;
    assert.equal(first.attempts, 1);
    failTask(db, first.id, "temporary\nerror");
    assert.equal(sqlite.prepare("SELECT status FROM task_queue").pluck().get(), "pending");

    const second = dequeueTask(db)!;
    completeTask(db, second.id);
    assert.equal(sqlite.prepare("SELECT status FROM task_queue").pluck().get(), "completed");
  } finally {
    sqlite.close();
  }
});
test("FTS rows update after analysis changes", () => {
  const { sqlite } = createDatabase();
  try {
    sqlite.exec("CREATE VIRTUAL TABLE posts_fts USING fts5(title, summary, content='', contentless_delete=1)");
    assert.equal(syncPostToFts(sqlite, 1), true);
    assert.equal(sqlite.prepare("SELECT count(*) FROM posts_fts WHERE posts_fts MATCH 'widget'").pluck().get(), 1);

    sqlite.prepare("INSERT INTO ai_analysis(post_id,summary,analyzed_at,model) VALUES (1,'quantum database',1,'test')").run();
    syncPostToFts(sqlite, 1);
    assert.equal(sqlite.prepare("SELECT count(*) FROM posts_fts WHERE posts_fts MATCH 'quantum'").pluck().get(), 1);
  } finally {
    sqlite.close();
  }
});

type QueueDb = ReturnType<typeof createDatabase>["db"];

// Each of these reads rows and then writes them inside one transaction.
const readThenWrite: {
  name: string;
  firstWrite: RegExp;
  queued: boolean;
  run: (db: QueueDb) => unknown;
  expected: unknown;
}[] = [
  { name: "dequeueBatch", firstWrite: /^\s*update/i, queued: true, run: (db) => dequeueBatch(db, 5).map((task) => task.status), expected: ["processing"] },
  { name: "dequeueTask", firstWrite: /^\s*update/i, queued: true, run: (db) => dequeueTask(db)?.status, expected: "processing" },
  { name: "bulkEnqueue", firstWrite: /^\s*insert/i, queued: false, run: (db) => bulkEnqueue(db, "process", [1]), expected: 1 },
];

for (const { name, firstWrite, queued, run, expected } of readThenWrite) {
  test(`${name} holds the write lock from its first statement, so another process's write cannot break it`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "showhn-queue-"));
    const file = path.join(dir, "queue.db");
    // The other process (ingest for the worker, the worker for a requeue): a second
    // connection that writes in the middle of the transaction under test.
    const other = createDatabase(file, { timeout: 0 });
    other.sqlite.pragma("journal_mode = WAL");
    if (queued) enqueueTask(other.db, "analyze", 1);

    let otherWrite: "not attempted" | "committed" | "blocked" = "not attempted";
    // better-sqlite3 reports each statement just before it runs.
    const sqlite = new Database(file, {
      timeout: 0,
      verbose: (statement) => {
        if (otherWrite !== "not attempted" || !firstWrite.test(String(statement))) return;
        try {
          other.sqlite.prepare("UPDATE posts SET title = 'Edited elsewhere' WHERE id = 1").run();
          otherWrite = "committed";
        } catch {
          otherWrite = "blocked";
        }
      },
    });
    try {
      // Started the default way, the transaction threw SQLITE_BUSY_SNAPSHOT ("database is
      // locked") here. In dequeueBatch that crashed the worker whenever ingest wrote.
      assert.deepEqual(run(drizzle(sqlite, { schema })), expected);
      assert.equal(otherWrite, "blocked");
    } finally {
      sqlite.close();
      other.sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

/** Pretend the worker died ten minutes ago, leaving its claimed tasks behind. */
function strand(sqlite: Database.Database) {
  sqlite.prepare("UPDATE task_queue SET started_at = started_at - 600 WHERE status = 'processing'").run();
}

function taskRow(sqlite: Database.Database) {
  return sqlite.prepare("SELECT status, attempts, started_at, error FROM task_queue").get();
}

test("reclaiming a stranded task does not use up a second attempt", () => {
  const { sqlite, db } = createDatabase();
  try {
    enqueueTask(db, "analyze", 1);
    dequeueTask(db); // attempt 1, then the worker dies mid-task
    strand(sqlite);

    assert.equal(reclaimStaleTasks(db, 300), 1);

    assert.deepEqual(taskRow(sqlite), { status: "pending", attempts: 1, started_at: null, error: null });
  } finally {
    sqlite.close();
  }
});

test("a task that strands the worker three times is failed on the third, not the second", () => {
  const { sqlite, db } = createDatabase();
  try {
    enqueueTask(db, "analyze", 1);
    const statuses: unknown[] = [];
    for (let crash = 1; crash <= 3; crash++) {
      dequeueTask(db);
      strand(sqlite);
      reclaimStaleTasks(db, 300);
      statuses.push(sqlite.prepare("SELECT status FROM task_queue").pluck().get());
    }

    assert.deepEqual(statuses, ["pending", "pending", "failed"]);
    assert.equal(sqlite.prepare("SELECT attempts FROM task_queue").pluck().get(), 3);
  } finally {
    sqlite.close();
  }
});

test("releasing a claimed task returns it to the queue with the attempt refunded", () => {
  const { sqlite, db } = createDatabase();
  try {
    enqueueTask(db, "analyze", 1);
    const task = dequeueTask(db)!;

    releaseTask(db, task.id, "worker\nshutting down");

    assert.deepEqual(taskRow(sqlite), { status: "pending", attempts: 0, started_at: null, error: "worker shutting down" });
  } finally {
    sqlite.close();
  }
});

test("releasing leaves a task alone once it has been completed", () => {
  const { sqlite, db } = createDatabase();
  try {
    enqueueTask(db, "analyze", 1);
    const task = dequeueTask(db)!;
    completeTask(db, task.id);

    releaseTask(db, task.id, "worker shutting down");

    assert.equal(sqlite.prepare("SELECT status FROM task_queue").pluck().get(), "completed");
    assert.equal(sqlite.prepare("SELECT attempts FROM task_queue").pluck().get(), 1);
  } finally {
    sqlite.close();
  }
});

test("only posts whose latest task failed are picked for a retry, each once", () => {
  const { sqlite, db } = createDatabase();
  try {
    const addPost = sqlite.prepare("INSERT INTO posts(id,title,author,created_at,fetched_at,updated_at) VALUES (?,?,'maker',1,1,1)");
    addPost.run(2, "Failed, then judged on a later task");
    addPost.run(3, "Never failed");
    addPost.run(4, "Failed as a text-only post");
    const addTask = sqlite.prepare("INSERT INTO task_queue(type,post_id,status,attempts,created_at) VALUES (?,?,?,3,1)");
    addTask.run("process", 1, "failed");
    addTask.run("process", 1, "failed"); // failed twice: still one post
    addTask.run("process", 2, "failed");
    addTask.run("process", 2, "completed"); // a later task succeeded
    addTask.run("process", 3, "completed");
    addTask.run("analyze", 4, "failed");

    assert.deepEqual(postIdsWithUnresolvedFailure(db, ["process", "screenshot"]), [1]);
    assert.deepEqual(postIdsWithUnresolvedFailure(db, ["analyze"]), [4]);
  } finally {
    sqlite.close();
  }
});

test("a task is on its last attempt once it has been claimed as often as it may be tried", () => {
  const { sqlite, db } = createDatabase();
  try {
    enqueueTask(db, "process", 1);
    const seen: boolean[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const task = dequeueTask(db)!;
      seen.push(isLastAttempt(task));
      failTask(db, task.id, "page did not load");
    }

    assert.deepEqual(seen, [false, false, true]);
    assert.equal(sqlite.prepare("SELECT status FROM task_queue").pluck().get(), "failed");
  } finally {
    sqlite.close();
  }
});

test("a task that has already failed waits behind tasks that have not been tried", () => {
  const { sqlite, db } = createDatabase();
  try {
    sqlite.prepare("INSERT INTO posts(id,title,author,created_at,fetched_at,updated_at) VALUES (2,'Second post','maker',2,2,2)").run();
    enqueueTask(db, "analyze", 1);
    enqueueTask(db, "analyze", 2);
    const first = dequeueTask(db)!;
    assert.equal(first.postId, 1);
    failTask(db, first.id, "judge rejected the request");

    // Retrying post 1 straight away would let one bad post hold up everything behind it.
    assert.deepEqual(dequeueBatch(db, 1).map((task) => task.postId), [2]);
    assert.deepEqual(dequeueBatch(db, 1).map((task) => task.postId), [1]);
  } finally {
    sqlite.close();
  }
});
