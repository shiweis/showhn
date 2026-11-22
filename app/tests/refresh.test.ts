import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/lib/db/schema";
import { fetchItemState } from "../src/lib/hn-api";
import { getStalePostIds, MISSING_LOOKUPS_PER_RUN, refreshStalePosts } from "../src/lib/refresh";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const now = () => Math.floor(Date.now() / 1000);

function createDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      points INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      status TEXT DEFAULT 'active',
      fetched_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function addPost(
  sqlite: Database.Database,
  post: { id: number; age: number; sinceUpdate: number; status?: string },
) {
  sqlite
    .prepare("INSERT INTO posts(id,title,author,points,comments,created_at,status,fetched_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(post.id, `Show HN: Post ${post.id}`, "maker", 1, 0, now() - post.age, post.status ?? "active", now(), now() - post.sinceUpdate);
}

const postRow = (sqlite: Database.Database, id: number) =>
  sqlite.prepare("SELECT status, points, comments, updated_at FROM posts WHERE id = ?").get(id) as {
    status: string;
    points: number;
    comments: number;
    updated_at: number;
  };

test("refresh takes the post that is most overdue for its age first, not the one updated longest ago", () => {
  const { sqlite, db } = createDatabase();
  try {
    addPost(sqlite, { id: 1, age: 10 * DAY, sinceUpdate: 30 * HOUR }); // due every 24h: 1.25x overdue
    addPost(sqlite, { id: 2, age: 2 * HOUR, sinceUpdate: 40 * 60 }); // due every 10 min: 4x overdue
    addPost(sqlite, { id: 3, age: 2 * DAY, sinceUpdate: 30 * 60 }); // due every hour: not due yet
    addPost(sqlite, { id: 4, age: 40 * DAY, sinceUpdate: 39 * DAY }); // older than 30 days: on-demand only
    addPost(sqlite, { id: 5, age: 2 * HOUR, sinceUpdate: 5 * HOUR, status: "dead" });

    assert.deepEqual(getStalePostIds(db), [2, 1]);
    assert.deepEqual(getStalePostIds(db, 1), [2]);
  } finally {
    sqlite.close();
  }
});

test("posts the HN search no longer returns are retired once HN itself says they are dead or deleted", async (t) => {
  t.mock.method(console, "log", () => {});
  const { sqlite, db } = createDatabase();
  try {
    for (const id of [1, 2, 3, 4, 5]) addPost(sqlite, { id, age: 2 * DAY, sinceUpdate: 5 * HOUR });
    const staleSince = postRow(sqlite, 5).updated_at;
    const lookedUp: number[] = [];

    const result = await refreshStalePosts(db, 100, {
      fetchBatch: async (ids) =>
        ids.filter((id) => id === 1).map((id) => ({ objectID: String(id), points: 42, num_comments: 9 })),
      fetchState: async (id) => {
        lookedUp.push(id);
        if (id === 2) return { state: "dead" };
        if (id === 3) return { state: "deleted" };
        if (id === 4) return { state: "live", score: 7, descendants: 2 };
        return { state: "unknown" }; // the lookup failed: says nothing about the post
      },
    });

    assert.deepEqual(result, { refreshed: 2, retired: 2 });
    assert.deepEqual(lookedUp.sort(), [2, 3, 4, 5]);
    assert.deepEqual([postRow(sqlite, 1).status, postRow(sqlite, 1).points, postRow(sqlite, 1).comments], ["active", 42, 9]);
    assert.equal(postRow(sqlite, 2).status, "dead");
    assert.equal(postRow(sqlite, 3).status, "dead");
    assert.deepEqual([postRow(sqlite, 4).status, postRow(sqlite, 4).points, postRow(sqlite, 4).comments], ["active", 7, 2]);
    assert.ok(postRow(sqlite, 4).updated_at > staleSince);
    assert.deepEqual(postRow(sqlite, 5), { status: "active", points: 1, comments: 0, updated_at: staleSince });
  } finally {
    sqlite.close();
  }
});

test("one run looks up only a bounded number of missing posts, so a search outage cannot stall ingest", async (t) => {
  t.mock.method(console, "log", () => {});
  const { sqlite, db } = createDatabase();
  try {
    for (let id = 1; id <= MISSING_LOOKUPS_PER_RUN + 10; id++) addPost(sqlite, { id, age: 2 * DAY, sinceUpdate: 5 * HOUR });
    let lookups = 0;

    await refreshStalePosts(db, 500, {
      fetchBatch: async () => [], // the search returned nothing at all
      fetchState: async () => {
        lookups++;
        return { state: "unknown" };
      },
    });

    assert.equal(lookups, MISSING_LOOKUPS_PER_RUN);
  } finally {
    sqlite.close();
  }
});

const hnAnswers: [string, unknown, Awaited<ReturnType<typeof fetchItemState>>][] = [
  ["a live story", { id: 1, type: "story", score: 12, descendants: 3 }, { state: "live", score: 12, descendants: 3 }],
  ["a story killed by flags or moderators", { id: 1, type: "story", dead: true, score: 2 }, { state: "dead" }],
  ["a story its author deleted", { id: 1, type: "story", deleted: true }, { state: "deleted" }],
  ["an empty answer", null, { state: "unknown" }],
];

for (const [name, body, expected] of hnAnswers) {
  test(`HN item lookup reads ${name} as ${expected.state}`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status: 200 }));
    assert.deepEqual(await fetchItemState(1), expected);
  });
}

test("HN item lookup reports unknown, never gone, when the request fails", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  assert.deepEqual(await fetchItemState(1), { state: "unknown" });

  t.mock.method(globalThis, "fetch", async () => new Response("upstream error", { status: 503 }));
  assert.deepEqual(await fetchItemState(1), { state: "unknown" });
});
