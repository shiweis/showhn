import test from "node:test";
import assert from "node:assert/strict";
import { createShortCache } from "../src/lib/short-cache";

/** A clock the test moves by hand. */
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

test("a result is reused until it is older than the limit", () => {
  const time = clock();
  const cache = createShortCache({ ttlMs: 5 * 60_000, now: time.now });
  let worked = 0;
  const work = () => (worked += 1);

  assert.equal(cache.get("stats", work), 1);
  time.advance(4 * 60_000 + 59_000);
  assert.equal(cache.get("stats", work), 1);
  assert.equal(worked, 1);

  time.advance(2_000);
  assert.equal(cache.get("stats", work), 2);
  assert.equal(worked, 2);
});

test("results under different names are kept apart", () => {
  const cache = createShortCache({ ttlMs: 60_000, now: clock().now });

  assert.equal(cache.get("a", () => "first"), "first");
  assert.equal(cache.get("b", () => "second"), "second");
  assert.equal(cache.get("a", () => "never asked for"), "first");
});

test("the oldest result goes when the cache is full", () => {
  const cache = createShortCache({ ttlMs: 60_000, maxEntries: 2, now: clock().now });
  cache.get("a", () => 1);
  cache.get("b", () => 2);
  cache.get("c", () => 3);

  let worked = 0;
  cache.get("b", () => (worked += 1));
  cache.get("c", () => (worked += 1));
  assert.equal(worked, 0, "the two newest are still there");
  cache.get("a", () => (worked += 1));
  assert.equal(worked, 1, "the oldest had to be worked out again");
});

test("a lookup that fails is not remembered", async () => {
  const cache = createShortCache({ ttlMs: 60_000, now: clock().now });
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error("database is locked");
    return "posts";
  };

  await assert.rejects(cache.get("list", flaky), /database is locked/);
  assert.equal(await cache.get("list", flaky), "posts");
  assert.equal(calls, 2);
});

test("work that throws at once is not remembered either", () => {
  const cache = createShortCache({ ttlMs: 60_000, now: clock().now });

  assert.throws(() => cache.get("stats", () => {
    throw new Error("no such table");
  }), /no such table/);
  assert.equal(cache.get("stats", () => 7), 7);
});
