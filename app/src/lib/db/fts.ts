import type Database from "better-sqlite3";

/**
 * The text indexed beside a post's title: its summary, then the names of the
 * products the judge compared it to, so that a search for one of those names
 * finds the post. Written for a query that calls posts `p` and ai_analysis `a`.
 *
 * The per-post update below and the nightly rebuild (scripts/setup-fts.ts)
 * both use it. With two definitions, a rebuild would drop the names again.
 */
export const FTS_SUMMARY_SQL = `(
  COALESCE(a.summary, '') ||
  CASE WHEN json_valid(a.similar_to)
    THEN COALESCE((SELECT ' ' || group_concat(names.value, ' ') FROM json_each(a.similar_to) AS names), '')
    ELSE ''
  END
)`;

/** Keep an existing FTS index fresh after a post or its analysis changes. */
export function syncPostToFts(sqlite: Database.Database, postId: number): boolean {
  const exists = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'posts_fts'")
    .get();
  if (!exists) return false;

  sqlite.prepare(`
    INSERT OR REPLACE INTO posts_fts(rowid, title, summary)
    SELECT p.id, p.title, ${FTS_SUMMARY_SQL}
    FROM posts p
    LEFT JOIN ai_analysis a ON a.post_id = p.id
    WHERE p.id = ?
  `).run(postId);
  return true;
}
