/**
 * Compare two LLM models on tier-classification accuracy and behavior.
 *
 * Two evals run per model:
 *   1. Leave-one-out on the 15 benchmark posts (labeled): each post is held out
 *      of the calibration prompt and re-scored. Accuracy + tier-bias measured.
 *   2. Fresh sample on N random recent posts (unlabeled): distribution drift
 *      and inter-model agreement measured.
 *
 * Usage:
 *   bun scripts/eval-models.ts \
 *     --baseline openrouter:qwen/qwen3.5-397b-a17b \
 *     --candidate openrouter:deepseek/deepseek-v4-flash \
 *     --sample 30 \
 *     --concurrency 2
 *
 * Models are specified as "<provider>:<model>". Provider must be one of:
 *   openrouter | anthropic | openai
 *
 * Concurrency is per-model (each model runs N parallel one-post batches).
 * One post per call so leave-one-out exclusion + per-post comparison is clean.
 */

import Database from "better-sqlite3";
import path from "path";
import dotenv from "dotenv";
import {
  analyzeBatch,
  TIERS,
  tierToPickScore,
  type Tier,
  type BatchPost,
  type AnalysisResult,
  type UsageStats,
} from "../src/lib/ai/llm";
import { BENCHMARK_ENTRIES } from "../src/lib/ai/benchmark";
import { loadScreenshot } from "./lib/screenshot-files";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

// ─── Pricing (USD per 1M tokens) ───────────────────────────────────────────
// Used for cost estimates. Update as providers shift.
const PRICING: Record<string, { input: number; output: number }> = {
  "qwen/qwen3.5-397b-a17b": { input: 0.39, output: 2.34 },
  "qwen/qwen3.5-plus-20260420": { input: 0.40, output: 2.40 },
  "qwen/qwen3.5-flash-02-23": { input: 0.065, output: 0.26 },
  "qwen/qwen3.6-plus": { input: 0.325, output: 1.95 },
  "qwen/qwen3.6-flash": { input: 0.25, output: 1.50 },
  "qwen/qwen3.6-27b": { input: 0.195, output: 1.56 },
  "qwen/qwen3.6-35b-a3b": { input: 0.1612, output: 0.96525 },
  "qwen/qwen3.6-max-preview": { input: 1.30, output: 7.80 },
  "deepseek/deepseek-v4-flash": { input: 0.14, output: 0.28 },
  "deepseek/deepseek-v4-pro": { input: 0.435, output: 0.87 },
  "anthropic/claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  // Fallback when model unknown
  default: { input: 0, output: 0 },
};

function priceFor(model: string) {
  return PRICING[model] || PRICING.default;
}

function computeCost(model: string, usage: UsageStats): number {
  const p = priceFor(model);
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}

// ─── Args ──────────────────────────────────────────────────────────────────
type ModelSpec = { provider: string; model: string; raw: string };

function parseModelSpec(raw: string): ModelSpec {
  const idx = raw.indexOf(":");
  if (idx === -1) throw new Error(`Invalid model spec "${raw}" — use provider:model`);
  return { provider: raw.slice(0, idx), model: raw.slice(idx + 1), raw };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: {
    baseline: string;
    candidate: string;
    sample: number;
    concurrency: number;
    skipLoo: boolean;
    skipSample: boolean;
    output?: string;
    noScreenshots: boolean;
  } = {
    baseline: "openrouter:qwen/qwen3.5-397b-a17b",
    candidate: "openrouter:deepseek/deepseek-v4-flash",
    sample: 30,
    concurrency: 2,
    skipLoo: false,
    skipSample: false,
    noScreenshots: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--baseline") flags.baseline = args[++i];
    else if (a === "--candidate") flags.candidate = args[++i];
    else if (a === "--sample") flags.sample = parseInt(args[++i], 10);
    else if (a === "--concurrency") flags.concurrency = parseInt(args[++i], 10);
    else if (a === "--skip-loo") flags.skipLoo = true;
    else if (a === "--skip-sample") flags.skipSample = true;
    else if (a === "--no-screenshots") flags.noScreenshots = true;
    else if (a === "--output") flags.output = args[++i];
  }
  return flags;
}

// ─── DB ────────────────────────────────────────────────────────────────────
const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db");
const sqlite = new Database(DB_PATH, { readonly: true });
sqlite.pragma("journal_mode = WAL");

type PostRow = {
  id: number;
  title: string;
  url: string | null;
  story_text: string | null;
  page_content: string | null;
  readme_content: string | null;
};

let SCREENSHOTS_ENABLED = true;

function loadBatchPost(row: PostRow): BatchPost {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    pageContent:
      row.page_content ||
      row.story_text?.replace(/<[^>]*>/g, " ").slice(0, 3000) ||
      row.title,
    storyText: row.story_text,
    readmeContent: row.readme_content || undefined,
    screenshotBase64: SCREENSHOTS_ENABLED ? loadScreenshot(row.id) : undefined,
  };
}

function fetchPostsByIds(ids: number[]): PostRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const stmt = sqlite.prepare(
    `SELECT id, title, url, story_text, page_content, readme_content
     FROM posts WHERE id IN (${placeholders})`,
  );
  return stmt.all(...ids) as PostRow[];
}

function fetchSamplePosts(n: number): PostRow[] {
  // Random sample from active posts that have AI analysis (so they have
  // page_content populated). Excludes benchmark IDs to avoid leakage.
  const exclude = BENCHMARK_ENTRIES.map((b) => b.postId);
  const placeholders = exclude.map(() => "?").join(",");
  const stmt = sqlite.prepare(
    `SELECT p.id, p.title, p.url, p.story_text, p.page_content, p.readme_content
     FROM posts p
     JOIN ai_analysis a ON a.post_id = p.id
     WHERE p.status = 'active'
       AND p.id NOT IN (${placeholders})
       AND p.page_content IS NOT NULL
     ORDER BY RANDOM() LIMIT ?`,
  );
  return stmt.all(...exclude, n) as PostRow[];
}

// ─── Eval primitive ────────────────────────────────────────────────────────
type ScoreRecord = {
  postId: number;
  title: string;
  expected?: Tier;
  actual: Tier;
  match?: boolean;
  signedDelta?: number; // pickScore(actual) - pickScore(expected), for tier-bias
  highlight: string;
  vibeTags: string[];
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  cost: number;
  error?: string;
};

async function scorePost(
  spec: ModelSpec,
  post: BatchPost,
  excludeBenchmarkIds?: number[],
): Promise<{ result: AnalysisResult; usage: UsageStats; model: string }> {
  const { results, model, usage } = await analyzeBatch([post], {
    providerOverride: spec.provider,
    modelOverride: spec.model,
    excludeBenchmarkIds,
    // Eval uses OpenRouter's auto routing so any model works regardless of
    // which provider serves it. Production pins to alibaba for Qwen stability.
    routerProviderOverride: spec.provider === "openrouter" ? "auto" : undefined,
    allowRouterFallbacks: true,
  });
  const result = results.get(post.id);
  if (!result) throw new Error(`No result returned for post ${post.id}`);
  return { result, usage, model };
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, idx: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function spin() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => spin()));
  return out;
}

// ─── Eval 1: Leave-one-out on benchmark ────────────────────────────────────
async function runLoo(spec: ModelSpec, concurrency: number): Promise<ScoreRecord[]> {
  const ids = BENCHMARK_ENTRIES.map((b) => b.postId);
  const rows = fetchPostsByIds(ids);
  const rowMap = new Map(rows.map((r) => [r.id, r]));

  const records: ScoreRecord[] = await runWithConcurrency(
    BENCHMARK_ENTRIES,
    async (entry) => {
      const row = rowMap.get(entry.postId);
      if (!row) {
        return {
          postId: entry.postId,
          title: entry.title,
          expected: entry.tier,
          actual: "mid",
          match: false,
          signedDelta: 0,
          highlight: "",
          vibeTags: [],
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
          cost: 0,
          error: "post missing from DB",
        };
      }
      try {
        const post = loadBatchPost(row);
        const { result, usage } = await scorePost(spec, post, [entry.postId]);
        const expectedScore = tierToPickScore(entry.tier);
        const actualScore = tierToPickScore(result.tier);
        return {
          postId: entry.postId,
          title: entry.title,
          expected: entry.tier,
          actual: result.tier,
          match: result.tier === entry.tier,
          signedDelta: actualScore - expectedScore,
          highlight: result.highlight,
          vibeTags: result.vibe_tags,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          durationMs: usage.durationMs,
          cost: computeCost(spec.model, usage),
        };
      } catch (err) {
        return {
          postId: entry.postId,
          title: entry.title,
          expected: entry.tier,
          actual: "mid",
          match: false,
          signedDelta: 0,
          highlight: "",
          vibeTags: [],
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
          cost: 0,
          error: (err as Error).message,
        };
      }
    },
    concurrency,
  );
  return records;
}

// ─── Eval 2: Fresh random sample (unlabeled) ───────────────────────────────
async function runSample(
  spec: ModelSpec,
  rows: PostRow[],
  concurrency: number,
): Promise<ScoreRecord[]> {
  return runWithConcurrency(
    rows,
    async (row) => {
      try {
        const post = loadBatchPost(row);
        const { result, usage } = await scorePost(spec, post);
        return {
          postId: row.id,
          title: row.title,
          actual: result.tier,
          highlight: result.highlight,
          vibeTags: result.vibe_tags,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          durationMs: usage.durationMs,
          cost: computeCost(spec.model, usage),
        };
      } catch (err) {
        return {
          postId: row.id,
          title: row.title,
          actual: "mid",
          highlight: "",
          vibeTags: [],
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
          cost: 0,
          error: (err as Error).message,
        };
      }
    },
    concurrency,
  );
}

// ─── Reporting ─────────────────────────────────────────────────────────────
function tierIndex(t: Tier): number {
  return TIERS.indexOf(t);
}

function summarize(records: ScoreRecord[]) {
  const ok = records.filter((r) => !r.error);
  const errors = records.length - ok.length;
  const totalCost = ok.reduce((s, r) => s + r.cost, 0);
  const totalIn = ok.reduce((s, r) => s + r.inputTokens, 0);
  const totalOut = ok.reduce((s, r) => s + r.outputTokens, 0);
  const avgLatency = ok.length ? ok.reduce((s, r) => s + r.durationMs, 0) / ok.length : 0;

  const tierCounts: Record<string, number> = {};
  for (const r of ok) tierCounts[r.actual] = (tierCounts[r.actual] || 0) + 1;

  // Labeled metrics (loo)
  const labeled = ok.filter((r) => r.expected);
  const exactMatch = labeled.filter((r) => r.match).length;
  const adjacentOk = labeled.filter(
    (r) => Math.abs(tierIndex(r.actual) - tierIndex(r.expected!)) <= 1,
  ).length;
  const meanSignedDelta =
    labeled.length === 0
      ? 0
      : labeled.reduce((s, r) => s + (r.signedDelta || 0), 0) / labeled.length;
  const meanAbsDelta =
    labeled.length === 0
      ? 0
      : labeled.reduce((s, r) => s + Math.abs(r.signedDelta || 0), 0) / labeled.length;

  return {
    n: records.length,
    nOk: ok.length,
    errors,
    totalCost,
    totalIn,
    totalOut,
    avgLatencyMs: avgLatency,
    tierCounts,
    labeled: labeled.length
      ? {
          n: labeled.length,
          exactPct: (exactMatch / labeled.length) * 100,
          adjacentPct: (adjacentOk / labeled.length) * 100,
          meanSignedDelta, // + = inflated, - = harsh (in pick_score units)
          meanAbsDelta,
        }
      : null,
  };
}

function printRecords(label: string, records: ScoreRecord[]) {
  console.log(`\n── ${label} ──`);
  for (const r of records) {
    const exp = r.expected ? `${r.expected.padEnd(6)} → ` : "";
    const mark = r.error ? "✗" : r.expected ? (r.match ? "✓" : "✗") : "·";
    const title = r.title.length > 60 ? r.title.slice(0, 57) + "..." : r.title;
    console.log(
      `  ${mark} ${exp}${r.actual.padEnd(6)} | ${r.postId} | ${title}${r.error ? `  [${r.error}]` : ""}`,
    );
  }
  const errs = records.filter((r) => r.error);
  if (errs.length) {
    console.log(`  ⚠ ${errs.length} error(s):`);
    for (const e of errs) console.log(`    - ${e.postId}: ${e.error}`);
  }
}

function printSummary(label: string, s: ReturnType<typeof summarize>) {
  console.log(`\n── ${label} summary ──`);
  console.log(`  n=${s.n} ok=${s.nOk} errors=${s.errors}`);
  console.log(
    `  tokens: in=${s.totalIn} out=${s.totalOut} | cost: $${s.totalCost.toFixed(4)} | avg latency: ${(s.avgLatencyMs / 1000).toFixed(1)}s`,
  );
  console.log(
    `  tiers: ${TIERS.map((t) => `${t}=${s.tierCounts[t] || 0}`).join("  ")}`,
  );
  if (s.labeled) {
    console.log(
      `  labeled: exact=${s.labeled.exactPct.toFixed(1)}%  adjacent=${s.labeled.adjacentPct.toFixed(1)}%  signed-bias=${s.labeled.meanSignedDelta >= 0 ? "+" : ""}${s.labeled.meanSignedDelta.toFixed(1)}  abs-delta=${s.labeled.meanAbsDelta.toFixed(1)}`,
    );
  }
}

function compareSamples(
  baselineSpec: ModelSpec,
  candidateSpec: ModelSpec,
  baseline: ScoreRecord[],
  candidate: ScoreRecord[],
) {
  const bMap = new Map(baseline.map((r) => [r.postId, r]));
  const cMap = new Map(candidate.map((r) => [r.postId, r]));
  const ids = [...new Set([...bMap.keys(), ...cMap.keys()])];

  let agree = 0;
  let agreeAdj = 0;
  let bothOk = 0;
  let candidateHigher = 0;
  let candidateLower = 0;
  const disagreements: { id: number; title: string; b: Tier; c: Tier }[] = [];

  for (const id of ids) {
    const b = bMap.get(id);
    const c = cMap.get(id);
    if (!b || !c || b.error || c.error) continue;
    bothOk++;
    if (b.actual === c.actual) agree++;
    if (Math.abs(tierIndex(b.actual) - tierIndex(c.actual)) <= 1) agreeAdj++;
    const delta = tierToPickScore(c.actual) - tierToPickScore(b.actual);
    if (delta > 0) candidateHigher++;
    if (delta < 0) candidateLower++;
    if (b.actual !== c.actual) {
      disagreements.push({ id, title: b.title, b: b.actual, c: c.actual });
    }
  }

  console.log(`\n── Sample agreement (baseline vs candidate) ──`);
  console.log(`  n=${bothOk}`);
  console.log(
    `  exact agreement: ${bothOk ? ((agree / bothOk) * 100).toFixed(1) : 0}%  adjacent: ${bothOk ? ((agreeAdj / bothOk) * 100).toFixed(1) : 0}%`,
  );
  console.log(
    `  candidate vs baseline: higher=${candidateHigher}  lower=${candidateLower}  same=${agree}`,
  );

  if (disagreements.length > 0) {
    console.log(`\n  Disagreements (first 15):`);
    for (const d of disagreements.slice(0, 15)) {
      const title = d.title.length > 55 ? d.title.slice(0, 52) + "..." : d.title;
      console.log(
        `    ${baselineSpec.model.split("/").pop()?.padEnd(20)} ${d.b.padEnd(6)} → ${candidateSpec.model.split("/").pop()?.padEnd(20)} ${d.c.padEnd(6)} | ${d.id} | ${title}`,
      );
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const flags = parseArgs();
  const baseline = parseModelSpec(flags.baseline);
  const candidate = parseModelSpec(flags.candidate);
  SCREENSHOTS_ENABLED = !flags.noScreenshots;

  console.log(`[eval] baseline:  ${baseline.provider}:${baseline.model}`);
  console.log(`[eval] candidate: ${candidate.provider}:${candidate.model}`);
  console.log(
    `[eval] sample=${flags.sample} concurrency=${flags.concurrency} screenshots=${SCREENSHOTS_ENABLED}`,
  );

  const startedAt = Date.now();

  const result: Record<string, unknown> = {
    startedAt: new Date(startedAt).toISOString(),
    baseline: baseline.raw,
    candidate: candidate.raw,
  };

  // ─── Loo ───
  if (!flags.skipLoo) {
    console.log("\n[eval] === Leave-one-out on 15 benchmark posts ===");
    console.log("[eval] Running baseline...");
    const looBaseline = await runLoo(baseline, flags.concurrency);
    printRecords(`baseline LOO`, looBaseline);
    const sBaseline = summarize(looBaseline);
    printSummary(`baseline LOO`, sBaseline);

    console.log("\n[eval] Running candidate...");
    const looCandidate = await runLoo(candidate, flags.concurrency);
    printRecords(`candidate LOO`, looCandidate);
    const sCandidate = summarize(looCandidate);
    printSummary(`candidate LOO`, sCandidate);

    result.loo = {
      baseline: { records: looBaseline, summary: sBaseline },
      candidate: { records: looCandidate, summary: sCandidate },
    };
  }

  // ─── Sample ───
  if (!flags.skipSample) {
    console.log(`\n[eval] === Fresh random sample (n=${flags.sample}) ===`);
    const sampleRows = fetchSamplePosts(flags.sample);
    console.log(`[eval] Loaded ${sampleRows.length} sample posts`);

    console.log("[eval] Running baseline on sample...");
    const sampleBaseline = await runSample(baseline, sampleRows, flags.concurrency);
    printRecords(`baseline sample`, sampleBaseline);
    printSummary(`baseline sample`, summarize(sampleBaseline));

    console.log("[eval] Running candidate on sample...");
    const sampleCandidate = await runSample(candidate, sampleRows, flags.concurrency);
    printRecords(`candidate sample`, sampleCandidate);
    printSummary(`candidate sample`, summarize(sampleCandidate));

    compareSamples(baseline, candidate, sampleBaseline, sampleCandidate);

    result.sample = {
      baseline: { records: sampleBaseline, summary: summarize(sampleBaseline) },
      candidate: { records: sampleCandidate, summary: summarize(sampleCandidate) },
    };
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[eval] Done in ${elapsed}s.`);

  if (flags.output) {
    const fs = await import("fs/promises");
    await fs.writeFile(flags.output, JSON.stringify(result, null, 2));
    console.log(`[eval] Wrote results → ${flags.output}`);
  }
}

main().catch((err) => {
  console.error("[eval] Fatal:", err);
  process.exit(1);
});
