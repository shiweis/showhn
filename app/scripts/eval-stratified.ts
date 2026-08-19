/**
 * Stratified re-rating eval: sample N posts per current tier (gem/banger/solid/mid/pass)
 * and re-rate them with a candidate model. Produces a 5×5 transition matrix showing
 * how the candidate redistributes posts across tiers vs the current production rating.
 *
 * The "ground truth" here is the current production rating in `ai_analysis.tier`
 * (Qwen 3.5 397B). This isn't true ground truth — it just shows whether the candidate
 * agrees, drifts up, or drifts down at scale. Combined with leave-one-out from
 * eval-models.ts, it gives a fuller picture.
 *
 * Usage:
 *   bun scripts/eval-stratified.ts \
 *     --candidate openrouter:qwen/qwen3.6-plus \
 *     --per-tier 10 \
 *     --concurrency 3 \
 *     --output data/evals/stratified-3.6-plus.json
 *
 * Includes a JSON-repair fallback for models that drop the leading `{` (Qwen 3.6 does this).
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
  type UsageStats,
} from "../src/lib/ai/llm";
import { loadScreenshot } from "./lib/screenshot-files";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

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
    candidate: string;
    perTier: number;
    concurrency: number;
    noScreenshots: boolean;
    output?: string;
    seed?: number;
  } = {
    candidate: "openrouter:qwen/qwen3.6-plus",
    perTier: 10,
    concurrency: 3,
    noScreenshots: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--candidate") flags.candidate = args[++i];
    else if (a === "--per-tier") flags.perTier = parseInt(args[++i], 10);
    else if (a === "--concurrency") flags.concurrency = parseInt(args[++i], 10);
    else if (a === "--no-screenshots") flags.noScreenshots = true;
    else if (a === "--output") flags.output = args[++i];
    else if (a === "--seed") flags.seed = parseInt(args[++i], 10);
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
  tier: Tier;
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

function fetchStratifiedSample(perTier: number): Map<Tier, PostRow[]> {
  const out = new Map<Tier, PostRow[]>();
  for (const tier of TIERS) {
    const stmt = sqlite.prepare(
      `SELECT p.id, p.title, p.url, p.story_text, p.page_content, p.readme_content, a.tier
       FROM posts p
       JOIN ai_analysis a ON a.post_id = p.id
       WHERE p.status = 'active'
         AND a.tier = ?
         AND p.page_content IS NOT NULL
       ORDER BY RANDOM()
       LIMIT ?`,
    );
    const rows = stmt.all(tier, perTier) as PostRow[];
    out.set(tier, rows);
  }
  return out;
}

// ─── Concurrency ───────────────────────────────────────────────────────────
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

// ─── Eval ──────────────────────────────────────────────────────────────────
type ScoreRecord = {
  postId: number;
  title: string;
  baselineTier: Tier;
  candidateTier?: Tier;
  signedDelta?: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  error?: string;
};

async function scoreOne(
  spec: ModelSpec,
  post: BatchPost,
): Promise<{ tier: Tier; usage: UsageStats }> {
  const { results, usage } = await analyzeBatch([post], {
    providerOverride: spec.provider,
    modelOverride: spec.model,
    routerProviderOverride: spec.provider === "openrouter" ? "auto" : undefined,
    allowRouterFallbacks: true,
  });
  const result = results.get(post.id);
  if (!result) throw new Error(`No result returned for post ${post.id}`);
  return { tier: result.tier, usage };
}

async function rateRow(spec: ModelSpec, row: PostRow): Promise<ScoreRecord> {
  try {
    const post = loadBatchPost(row);
    const { tier, usage } = await scoreOne(spec, post);
    const delta = tierToPickScore(tier) - tierToPickScore(row.tier);
    return {
      postId: row.id,
      title: row.title,
      baselineTier: row.tier,
      candidateTier: tier,
      signedDelta: delta,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      durationMs: usage.durationMs,
    };
  } catch (err) {
    return {
      postId: row.id,
      title: row.title,
      baselineTier: row.tier,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      error: (err as Error).message,
    };
  }
}

// ─── Reporting ─────────────────────────────────────────────────────────────
function tierIdx(t: Tier): number {
  return TIERS.indexOf(t);
}

function buildMatrix(records: ScoreRecord[]): Record<Tier, Record<Tier | "error", number>> {
  const m: Record<string, Record<string, number>> = {};
  for (const baseTier of TIERS) {
    m[baseTier] = { error: 0 };
    for (const targetTier of TIERS) m[baseTier][targetTier] = 0;
  }
  for (const r of records) {
    if (r.error || !r.candidateTier) m[r.baselineTier].error++;
    else m[r.baselineTier][r.candidateTier]++;
  }
  return m as Record<Tier, Record<Tier | "error", number>>;
}

function printMatrix(matrix: Record<Tier, Record<Tier | "error", number>>) {
  const cols: (Tier | "error")[] = [...TIERS, "error"];
  const colWidth = 7;
  const rowLabelWidth = 10;

  // Header
  const header =
    " ".repeat(rowLabelWidth) +
    cols.map((c) => c.padStart(colWidth)).join("") +
    "  total  preserved";
  console.log(header);
  console.log("─".repeat(header.length));

  for (const baseTier of TIERS) {
    const row = matrix[baseTier];
    const total = cols.reduce((s, c) => s + row[c], 0);
    const preserved = total === 0 ? 0 : (row[baseTier] / total) * 100;
    const cells = cols.map((c) => String(row[c]).padStart(colWidth)).join("");
    console.log(
      `${baseTier.padEnd(rowLabelWidth)}${cells}${String(total).padStart(7)}  ${preserved.toFixed(0)}%`,
    );
  }
}

function printSummary(spec: ModelSpec, records: ScoreRecord[]) {
  const ok = records.filter((r) => !r.error && r.candidateTier);
  const errors = records.length - ok.length;

  console.log(`\n── Candidate: ${spec.raw} ──`);
  console.log(`  total=${records.length}  ok=${ok.length}  errors=${errors}`);

  const totalIn = records.reduce((s, r) => s + r.inputTokens, 0);
  const totalOut = records.reduce((s, r) => s + r.outputTokens, 0);
  const avgLatency = ok.length
    ? ok.reduce((s, r) => s + r.durationMs, 0) / ok.length
    : 0;
  console.log(
    `  tokens: in=${totalIn} out=${totalOut} | avg latency: ${(avgLatency / 1000).toFixed(1)}s`,
  );

  // Drift summary
  const ups = ok.filter((r) => (r.signedDelta || 0) > 0).length;
  const downs = ok.filter((r) => (r.signedDelta || 0) < 0).length;
  const same = ok.filter((r) => (r.signedDelta || 0) === 0).length;
  const meanSigned = ok.length
    ? ok.reduce((s, r) => s + (r.signedDelta || 0), 0) / ok.length
    : 0;
  const meanAbs = ok.length
    ? ok.reduce((s, r) => s + Math.abs(r.signedDelta || 0), 0) / ok.length
    : 0;
  const adjacent = ok.filter(
    (r) => Math.abs(tierIdx(r.candidateTier!) - tierIdx(r.baselineTier)) <= 1,
  ).length;

  console.log(
    `  drift: up=${ups}  same=${same}  down=${downs}  | signed-bias=${meanSigned >= 0 ? "+" : ""}${meanSigned.toFixed(1)}  abs-delta=${meanAbs.toFixed(1)}  adjacent=${ok.length ? ((adjacent / ok.length) * 100).toFixed(1) : 0}%`,
  );

  // Final tier distribution from candidate
  const dist: Record<string, number> = {};
  for (const r of ok) dist[r.candidateTier!] = (dist[r.candidateTier!] || 0) + 1;
  console.log(
    `  candidate tier mix: ${TIERS.map((t) => `${t}=${dist[t] || 0}`).join("  ")}`,
  );

  console.log();
  console.log("Transition matrix (rows=baseline tier, cols=candidate tier):");
  printMatrix(buildMatrix(records));
}

function printDisagreements(records: ScoreRecord[], limit = 30) {
  const disagreements = records
    .filter((r) => !r.error && r.candidateTier && r.candidateTier !== r.baselineTier)
    .sort((a, b) => Math.abs(b.signedDelta || 0) - Math.abs(a.signedDelta || 0));
  if (disagreements.length === 0) return;
  console.log(`\n── Disagreements (top ${Math.min(limit, disagreements.length)} by drift magnitude) ──`);
  for (const r of disagreements.slice(0, limit)) {
    const arrow = (r.signedDelta || 0) > 0 ? "↑" : "↓";
    const title = r.title.length > 65 ? r.title.slice(0, 62) + "..." : r.title;
    console.log(
      `  ${arrow} ${r.baselineTier.padEnd(6)} → ${r.candidateTier!.padEnd(6)} | ${r.postId} | ${title}`,
    );
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const flags = parseArgs();
  const candidate = parseModelSpec(flags.candidate);
  SCREENSHOTS_ENABLED = !flags.noScreenshots;

  console.log(`[eval-stratified] candidate: ${candidate.raw}`);
  console.log(
    `[eval-stratified] per-tier=${flags.perTier} concurrency=${flags.concurrency} screenshots=${SCREENSHOTS_ENABLED}`,
  );

  const sample = fetchStratifiedSample(flags.perTier);
  let totalSampled = 0;
  for (const tier of TIERS) {
    const rows = sample.get(tier) || [];
    totalSampled += rows.length;
    console.log(`  ${tier}: ${rows.length}`);
  }
  console.log(`  total: ${totalSampled}\n`);

  const allRows: PostRow[] = [];
  for (const tier of TIERS) allRows.push(...(sample.get(tier) || []));

  const startedAt = Date.now();
  const records = await runWithConcurrency(
    allRows,
    (row) => rateRow(candidate, row),
    flags.concurrency,
  );

  printSummary(candidate, records);
  printDisagreements(records);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[eval-stratified] Done in ${elapsed}s.`);

  if (flags.output) {
    const fs = await import("fs/promises");
    const matrix = buildMatrix(records);
    const payload = {
      startedAt: new Date(startedAt).toISOString(),
      candidate: candidate.raw,
      perTier: flags.perTier,
      records,
      matrix,
    };
    await fs.writeFile(flags.output, JSON.stringify(payload, null, 2));
    console.log(`[eval-stratified] Wrote results → ${flags.output}`);
  }
}

main().catch((err) => {
  console.error("[eval-stratified] Fatal:", err);
  process.exit(1);
});
