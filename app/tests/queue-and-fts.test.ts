import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/lib/db/schema";
import {
  completeTask,
  dequeueTask,
  enqueueTask,
  failTask,
} from "../src/lib/queue";
import { syncPostToFts } from "../src/lib/db/fts";

function createDatabase() {
  const sqlite = new Database(":memory:");
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
