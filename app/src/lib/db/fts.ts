import type Database from "better-sqlite3";

/** Keep an existing FTS index fresh after a post or its analysis changes. */
export function syncPostToFts(sqlite: Database.Database, postId: number): boolean {
  const exists = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'posts_fts'")
    .get();
  if (!exists) return false;

  sqlite.prepare(`
    INSERT OR REPLACE INTO posts_fts(rowid, title, summary)
    SELECT p.id, p.title, COALESCE(a.summary, '')
    FROM posts p
    LEFT JOIN ai_analysis a ON a.post_id = p.id
    WHERE p.id = ?
  `).run(postId);
  return true;
}
