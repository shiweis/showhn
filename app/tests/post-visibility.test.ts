import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

test("a post that is dead or deleted on HN cannot be opened by its direct link", async () => {
  process.env.DATABASE_PATH = ":memory:";
  const { getPost } = await import("../src/lib/db/queries");
  const { db, sqlite } = await import("../src/lib/db/index");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");

  try {
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    const insert = sqlite.prepare(
      "INSERT INTO posts (id, title, author, created_at, fetched_at, updated_at, status) VALUES (?, ?, 'maker', 1, 1, 1, ?)",
    );
    insert.run(1, "Show HN: Still live", "active");
    insert.run(2, "Show HN: Killed on HN", "dead");

    assert.equal((await getPost(1))?.title, "Show HN: Still live");
    assert.equal(await getPost(2), null);
  } finally {
    sqlite.close();
  }
});
