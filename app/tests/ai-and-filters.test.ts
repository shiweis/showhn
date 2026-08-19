import test from "node:test";
import assert from "node:assert/strict";
import { parseBatchResult } from "../src/lib/ai/llm";
import {
  normalizeCategories,
  normalizeInteger,
  normalizeSort,
  normalizeTime,
} from "../src/lib/post-filters";

test("request filters reject unknown values and invalid pagination", () => {
  assert.equal(normalizeTime("forever"), "week");
  assert.equal(normalizeSort("random"), "newest");
  assert.deepEqual(normalizeCategories(["AI/ML", "made-up", "AI/ML"]), ["AI/ML"]);
  assert.equal(normalizeInteger(Number.NaN, 48, 1, 100), 48);
  assert.equal(normalizeInteger(1000, 48, 1, 100), 100);
});

test("LLM parsing enforces output lengths and array bounds", () => {
  const raw = JSON.stringify({
    summary: "x".repeat(500),
    category: "AI/ML",
    target_audience: "developers",
    tier: "gem",
    vibe_tags: ["Wizardry", "invalid", "Big Brain", "Slick", "Cozy"],
    highlight: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen",
    strengths: ["a", "b", "c", "d"],
    weaknesses: ["a", "b", "c"],
    similar_to: ["a", "b", "c", "d"],
  });

  const result = parseBatchResult(raw, [42], true).get(42)!;
  assert.equal(result.summary.length, 300);
  assert.equal(result.highlight.split(/\s+/).length, 15);
  assert.deepEqual(result.vibe_tags, ["Wizardry", "Big Brain", "Slick"]);
  assert.equal(result.strengths.length, 3);
  assert.equal(result.weaknesses.length, 2);
  assert.equal(result.similar_to.length, 3);
});
