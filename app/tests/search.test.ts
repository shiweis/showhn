import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

test("search finds posts containing every word, reports the true total and pages through it", async () => {
  process.env.DATABASE_PATH = ":memory:";
  const { searchPosts } = await import("../src/lib/db/queries");
  const { db, sqlite } = await import("../src/lib/db/index");
  const { syncPostToFts } = await import("../src/lib/db/fts");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");

  try {
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") }); // creates posts_fts too
    const insert = sqlite.prepare(
      "INSERT INTO posts (id, title, author, created_at, fetched_at, updated_at, status) VALUES (?, ?, 'maker', 1, 1, 1, ?)",
    );
    const titles: [number, string, string][] = [
      [1, "Show HN: Rust database engine", "active"],
      [2, "Show HN: A database for people who love Rust", "active"], // both words, not next to each other
      [3, "Show HN: Python web framework", "active"],
      [4, "Show HN: Rust database that HN killed", "dead"],
      [5, "Show HN: Rust game", "active"],
    ];
    for (const [id, title, status] of titles) {
      insert.run(id, title, status);
      syncPostToFts(sqlite, id);
    }

    const both = await searchPosts("rust database");
    assert.deepEqual(both.posts.map((post) => post.id).sort(), [1, 2]);
    assert.equal(both.total, 2);
    assert.equal(both.matched, "all");

    // Paging: one result per page still reports the full total.
    const first = await searchPosts("rust database", { limit: 1, offset: 0 });
    const second = await searchPosts("rust database", { limit: 1, offset: 1 });
    assert.equal(first.posts.length, 1);
    assert.equal(first.total, 2);
    assert.deepEqual([first.posts[0].id, second.posts[0].id].sort(), [1, 2]);

    // No post has every word: fall back to posts with any of them.
    const fallback = await searchPosts("rust zebra");
    assert.deepEqual(fallback.posts.map((post) => post.id).sort(), [1, 2, 5]);
    assert.equal(fallback.matched, "any");

    // A quoted phrase must appear as written.
    const phrase = await searchPosts('"rust database"');
    assert.deepEqual(phrase.posts.map((post) => post.id), [1]);

    assert.deepEqual(await searchPosts("   "), { posts: [], total: 0, matched: "all" });
    assert.deepEqual(await searchPosts("zebra"), { posts: [], total: 0, matched: "all" });
  } finally {
    sqlite.close();
  }
});
