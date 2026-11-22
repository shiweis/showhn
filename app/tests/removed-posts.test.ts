import test from "node:test";
import assert from "node:assert/strict";
import { parseRemovedPostIds } from "../src/lib/removed-posts";

test("removed post ids are read from a comma-separated setting", () => {
  assert.deepEqual(parseRemovedPostIds("101, 202,303"), new Set([101, 202, 303]));
});

test("an unset or empty setting removes nothing", () => {
  assert.equal(parseRemovedPostIds(undefined).size, 0);
  assert.equal(parseRemovedPostIds("").size, 0);
  assert.equal(parseRemovedPostIds(" , ").size, 0);
});

test("a value that is not a post id stops ingest rather than letting a removed post back in", () => {
  assert.throws(() => parseRemovedPostIds("101,abc"), /REMOVED_POST_IDS/);
  assert.throws(() => parseRemovedPostIds("101 202"), /REMOVED_POST_IDS/);
});
