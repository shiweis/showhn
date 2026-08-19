import test from "node:test";
import assert from "node:assert/strict";

test("related-post search expands past inactive FTS candidates", async () => {
  process.env.DATABASE_PATH = ":memory:";
  const queriesModule = await import("../src/lib/db/queries");
  const databaseModule = await import("../src/lib/db/index");
  const { getRelatedPosts } = queriesModule;
  const { sqlite } = databaseModule;

  try {
    sqlite.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT,
        author TEXT NOT NULL,
        points INTEGER,
        comments INTEGER,
        created_at INTEGER NOT NULL,
        story_text TEXT,
        has_screenshot INTEGER,
        github_stars INTEGER,
        github_language TEXT,
        github_description TEXT,
        status TEXT
      );
      CREATE TABLE ai_analysis (
        post_id INTEGER PRIMARY KEY,
        summary TEXT,
        category TEXT,
        pick_reason TEXT,
        pick_score INTEGER,
        tier TEXT,
        vibe_tags TEXT
      );
      CREATE VIRTUAL TABLE posts_fts USING fts5(
        title,
        summary,
        content='',
        contentless_delete=1,
        tokenize='porter unicode61'
      );
    `);

    const insertPost = sqlite.prepare(`
      INSERT INTO posts (
        id, title, url, author, points, comments, created_at,
        story_text, has_screenshot, status
      ) VALUES (?, ?, NULL, 'author', 0, 0, 1, NULL, 0, ?)
    `);
    const insertFts = sqlite.prepare(
      "INSERT INTO posts_fts(rowid, title, summary) VALUES (?, ?, '')",
    );

    const seed = sqlite.transaction(() => {
      // These rank ahead of the active rows and fill the first 100 candidates.
      for (let id = 2; id < 122; id++) {
        insertPost.run(id, "alpha beta alpha beta", "dead");
        insertFts.run(id, "alpha beta alpha beta");
      }
      for (let id = 122; id < 128; id++) {
        insertPost.run(id, "alpha", "active");
        insertFts.run(id, "alpha");
      }
    });
    seed();

    const related = await getRelatedPosts(1, "Show HN: alpha beta", "", 6);
    assert.deepEqual(related.map((post) => post.id), [122, 123, 124, 125, 126, 127]);
    assert.ok(related.every((post) => post.status === "active"));
  } finally {
    sqlite.close();
  }
});
