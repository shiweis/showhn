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
  assert.equal(result.highlight.split(/\s+/).length, 17); // fits a card, so it is kept whole
  assert.deepEqual(result.vibe_tags, ["Wizardry", "Big Brain", "Slick"]);
  assert.equal(result.strengths.length, 3);
  assert.equal(result.weaknesses.length, 2);
  assert.equal(result.similar_to.length, 3);
});

function highlightOf(text: string): string {
  const raw = JSON.stringify({
    summary: "A tool.",
    category: "AI/ML",
    target_audience: "developers",
    tier: "solid",
    vibe_tags: ["Cozy"],
    highlight: text,
    strengths: ["a"],
    weaknesses: ["b"],
    similar_to: [],
  });
  return parseBatchResult(raw, [1], true).get(1)!.highlight;
}

test("a highlight a little over the 15-word guideline is kept whole instead of being cut mid-sentence", () => {
  const seventeenWords = "Agent memory with hybrid search and graph retrieval, but two bigger tools occupy this space already today.";
  assert.equal(seventeenWords.split(/\s+/).length, 17);

  assert.equal(highlightOf(seventeenWords), seventeenWords);
});

test("a highlight too long for a card ends on a whole word with an ellipsis", () => {
  const long =
    "Cross-linking pull requests, tickets and chat into agent context sounds useful, but the core idea overlaps with existing tools and the demo is thin.";

  const shown = highlightOf(long);

  assert.ok(shown.length <= 120, `shown is ${shown.length} characters`);
  assert.ok(shown.endsWith("…"));
  const kept = shown.slice(0, -1);
  assert.ok(long.startsWith(kept));
  assert.match(long.slice(kept.length), /^[\s,;:.]/); // the cut falls between words
  assert.doesNotMatch(kept, /[\s,;:.]$/);
});
