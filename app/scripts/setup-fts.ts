/**
 * Creates and populates the FTS5 virtual table for search.
 * Run once after initial ingestion, and again after backfills.
 * Run: npx tsx scripts/setup-fts.ts
 */

import Database from "better-sqlite3";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Create FTS5 virtual table
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
    title,
    summary,
    content='',
    contentless_delete=1,
    tokenize='porter unicode61'
  );
`);

// Populate from posts + ai_analysis
const posts = db
  .prepare(`
    SELECT p.id, p.title, a.summary
    FROM posts p
    LEFT JOIN ai_analysis a ON p.id = a.post_id
  `)
  .all() as { id: number; title: string; summary: string | null }[];

const insert = db.prepare(`
  INSERT OR REPLACE INTO posts_fts(rowid, title, summary)
  VALUES (?, ?, ?)
`);

const tx = db.transaction(() => {
  // Clear and repopulate
  db.exec("DELETE FROM posts_fts");
  for (const post of posts) {
    insert.run(post.id, post.title, post.summary || "");
  }
});

tx();
console.log(`[fts] Indexed ${posts.length} posts`);
db.close();
