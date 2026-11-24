import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

test("a post is found by the name of a product the judge compared it to", async () => {
  process.env.DATABASE_PATH = ":memory:";
  const { searchPosts } = await import("../src/lib/db/queries");
  const { db, sqlite } = await import("../src/lib/db/index");
  const { syncPostToFts } = await import("../src/lib/db/fts");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");

  try {
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    const addPost = sqlite.prepare(
      "INSERT INTO posts (id, title, author, created_at, fetched_at, updated_at, status) VALUES (?, ?, 'maker', 1, 1, 1, 'active')",
    );
    const addVerdict = sqlite.prepare(
      "INSERT INTO ai_analysis (post_id, analyzed_at, model, summary, similar_to) VALUES (?, 1, 'test-model', ?, ?)",
    );
    addPost.run(1, "Show HN: Pagewright, notes that link themselves");
    addVerdict.run(1, "A notebook for small teams.", JSON.stringify(["Quillbase", "Field Notes Pro"]));
    addPost.run(2, "Show HN: A kanban board in the terminal");
    addVerdict.run(2, "Cards and columns for the command line.", JSON.stringify(["Boardly"]));
    addPost.run(3, "Show HN: A post whose list of names is damaged");
    addVerdict.run(3, "Still findable by its summary.", "[not json");
    addPost.run(4, "Show HN: A post with no verdict yet");
    for (const id of [1, 2, 3, 4]) syncPostToFts(sqlite, id);

    assert.deepEqual((await searchPosts("quillbase")).posts.map((post) => post.id), [1]);
    assert.deepEqual((await searchPosts('"field notes pro"')).posts.map((post) => post.id), [1], "a name of several words, as the post page links it");
    assert.deepEqual((await searchPosts("boardly")).posts.map((post) => post.id), [2]);
    // The summary and the title still match as before.
    assert.deepEqual((await searchPosts("notebook teams")).posts.map((post) => post.id), [1]);
    assert.deepEqual((await searchPosts("damaged")).posts.map((post) => post.id), [3]);
    assert.deepEqual((await searchPosts("findable")).posts.map((post) => post.id), [3]);
    assert.deepEqual((await searchPosts("verdict")).posts.map((post) => post.id), [4]);
  } finally {
    sqlite.close();
  }
});

test("the nightly rebuild indexes the same text as the per-post update", async () => {
  const fs = await import("node:fs");
  const rebuild = fs.readFileSync(path.join(process.cwd(), "scripts", "setup-fts.ts"), "utf8");

  // Both paths must build the indexed text from one definition, or a rebuild would drop the names again.
  assert.match(rebuild, /FTS_SUMMARY_SQL/);
});
