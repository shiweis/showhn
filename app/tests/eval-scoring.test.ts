import test from "node:test";
import assert from "node:assert/strict";
import { buildReferenceEntries, scoreTier } from "../src/lib/ai/eval-scoring";

test("a prediction matching any acceptable reference tier is exact", () => {
  assert.deepEqual(scoreTier("solid", ["banger", "solid"]), {
    exact: true,
    tierDistance: 0,
    nearest: "solid",
  });
});

test("a miss is measured to the nearest acceptable tier", () => {
  // Tier order is gem, banger, solid, mid, pass: pass is two steps from solid, three from banger.
  assert.deepEqual(scoreTier("pass", ["banger", "solid"]), {
    exact: false,
    tierDistance: 2,
    nearest: "solid",
  });
  assert.deepEqual(scoreTier("gem", ["banger"]), { exact: false, tierDistance: 1, nearest: "banger" });
});

test("labelling runs that agree give a firm single-tier reference", () => {
  assert.deepEqual(
    buildReferenceEntries([
      { postId: 7, run: 1, tier: "mid" },
      { postId: 7, run: 2, tier: "mid" },
    ]),
    [{ postId: 7, acceptable: ["mid"], firm: true }],
  );
});

test("labelling runs that disagree accept either tier and mark the post as a boundary case", () => {
  assert.deepEqual(
    buildReferenceEntries([
      { postId: 9, run: 1, tier: "solid" },
      { postId: 9, run: 2, tier: "banger" },
    ]),
    [{ postId: 9, acceptable: ["banger", "solid"], firm: false }],
  );
});

test("a post with fewer labelling runs than required is left out of the reference", () => {
  assert.deepEqual(
    buildReferenceEntries(
      [
        { postId: 1, run: 1, tier: "gem" },
        { postId: 2, run: 1, tier: "pass" },
        { postId: 2, run: 2, tier: "pass" },
      ],
      2,
    ),
    [{ postId: 2, acceptable: ["pass"], firm: true }],
  );
});
