import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const HOUR = 3600;
const DAY = 24 * HOUR;
/** A fixed "now" for every test, in unix seconds. */
const NOW = 1_800_000_000;

type PostOptions = { tier?: string | null; points?: number; ageSeconds?: number; status?: string };

let nextId = 0;
let migrated = false;

/** The site's own database module on an empty in-memory database with the real schema. */
async function open() {
  process.env.DATABASE_PATH = ":memory:";
  const { sqlite } = await import("../src/lib/db/index");
  const trends = await import("../src/lib/db/trends-queries");
  if (!migrated) {
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    migrated = true;
  }
  sqlite.exec("DELETE FROM ai_analysis; DELETE FROM posts;");

  const addPost = sqlite.prepare(
    "INSERT INTO posts (id, title, author, points, comments, created_at, fetched_at, updated_at, status) VALUES (?, ?, 'maker', ?, 0, ?, ?, ?, ?)",
  );
  const addVerdict = sqlite.prepare(
    "INSERT INTO ai_analysis (post_id, analyzed_at, model, tier, pick_score, summary) VALUES (?, ?, 'test-model', ?, 50, 'An invented project')",
  );

  /** A post created `ageSeconds` before NOW; it has a verdict unless `tier` is null. */
  function post({ tier = "solid", points = 0, ageSeconds = 5 * DAY, status = "active" }: PostOptions = {}) {
    nextId += 1;
    const created = NOW - ageSeconds;
    addPost.run(nextId, `Show HN: Invented project ${nextId}`, points, created, created, created, status);
    if (tier) addVerdict.run(nextId, created + 60, tier);
    return nextId;
  }

  return { post, read: () => trends.readDivergenceData(NOW), trends };
}

test("every judged post counts as analyzed, the solid ones too", async () => {
  const db = await open();
  for (const tier of ["gem", "banger", "solid", "solid", "mid", "pass"]) db.post({ tier });
  db.post({ tier: "solid", status: "dead" });
  db.post({ tier: null });

  assert.equal(db.read().stats.totalAnalyzed, 6);
});

test("a gem with few points is hidden only once it has had two days to collect them", async () => {
  const db = await open();
  const overlooked = db.post({ tier: "gem", points: 4, ageSeconds: 3 * DAY });
  db.post({ tier: "gem", points: 2, ageSeconds: HOUR });
  db.post({ tier: "gem", points: 9, ageSeconds: 47 * HOUR });
  db.post({ tier: "gem", points: 50, ageSeconds: 3 * DAY });

  const data = db.read();

  assert.equal(data.stats.hiddenGems, 1);
  assert.deepEqual(data.gems.map((post) => post.id), [overlooked]);
});

test("a gem that is exactly two days old with ten points counts as hidden", async () => {
  const db = await open();
  const atTheLine = db.post({ tier: "gem", points: 10, ageSeconds: 48 * HOUR });

  const data = db.read();

  assert.equal(data.stats.hiddenGems, 1);
  assert.deepEqual(data.gems.map((post) => post.id), [atTheLine]);
});

test("agreement is still worked out over the posts the judge had an opinion on", async () => {
  const db = await open();
  db.post({ tier: "gem", points: 20 }); // both liked it
  db.post({ tier: "banger", points: 5 }); // the judge liked it, HN did not
  db.post({ tier: "mid", points: 3 }); // neither did
  db.post({ tier: "pass", points: 40 }); // HN liked it, the judge did not
  for (let i = 0; i < 6; i += 1) db.post({ tier: "solid", points: 100 }); // no opinion either way

  const { stats } = db.read();

  assert.equal(stats.agreementPct, 50);
  assert.equal(stats.overhyped, 1);
  assert.equal(stats.totalAnalyzed, 10);
});

test("the page's numbers are worked out once and reused for a while", async () => {
  const db = await open();
  db.post({ tier: "gem", points: 1 });

  const first = db.trends.getDivergenceData();
  db.post({ tier: "mid", points: 90 });
  const second = db.trends.getDivergenceData();

  assert.equal(second, first);
});
