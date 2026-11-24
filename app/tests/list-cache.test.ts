import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

let nextId = 0;
let migrated = false;

/** The site's own query module on an empty in-memory database with the real schema. */
async function open() {
  process.env.DATABASE_PATH = ":memory:";
  const { sqlite } = await import("../src/lib/db/index");
  const queries = await import("../src/lib/db/queries");
  if (!migrated) {
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    migrated = true;
  }
  sqlite.exec("DELETE FROM ai_analysis; DELETE FROM posts;");

  const addPost = sqlite.prepare(
    "INSERT INTO posts (id, title, author, points, comments, created_at, fetched_at, updated_at, status) VALUES (?, ?, 'maker', 1, 0, ?, ?, ?, 'active')",
  );
  /** A post created an hour ago by the real clock, which is what the list filters use. */
  function post() {
    nextId += 1;
    const created = Math.floor(Date.now() / 1000) - 3600;
    addPost.run(nextId, `Show HN: Invented project ${nextId}`, created, created, created);
    return nextId;
  }

  return { post, queries };
}

test("an all-time list is worked out once and reused for a few minutes", async () => {
  const db = await open();
  db.post();

  const first = await db.queries.getPostsCached({ time: "all", sort: "points" });
  db.post();
  const again = await db.queries.getPostsCached({ time: "all", sort: "points" });

  assert.equal(first.total, 1);
  assert.equal(again.total, 1, "the second post is not counted until the remembered list expires");
  assert.equal((await db.queries.getPosts({ time: "all", sort: "points" })).total, 2, "the plain query stays fresh");
});

test("all-time lists with different filters are remembered apart", async () => {
  const db = await open();
  db.post();
  db.post();

  const byComments = await db.queries.getPostsCached({ time: "all", sort: "comments", limit: 1 });
  const nextPage = await db.queries.getPostsCached({ time: "all", sort: "comments", limit: 1, offset: 1 });

  assert.equal(byComments.posts.length, 1);
  assert.equal(nextPage.posts.length, 1);
  assert.notEqual(byComments.posts[0].id, nextPage.posts[0].id);
});

test("lists for a recent period are always fresh", async () => {
  const db = await open();
  db.post();

  const first = await db.queries.getPostsCached({ time: "week", sort: "newest" });
  db.post();
  const again = await db.queries.getPostsCached({ time: "week", sort: "newest" });

  assert.equal(first.total, 1);
  assert.equal(again.total, 2);
});
