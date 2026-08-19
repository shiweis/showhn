/**
 * Single-model judging eval against human-audited labels.
 *
 * Unlike eval-models.ts, this runner never treats production/Qwen judgments as
 * ground truth and does not compute inter-model agreement. Prompt development
 * uses leave-one-out calibration entries; final evaluation uses a disjoint
 * holdout set that is never included in the system prompt.
 *
 * Examples:
 *   npx tsx scripts/eval-judge.ts --split calibration --prompt production
 *   npx tsx scripts/eval-judge.ts --split holdout --prompt minimax-m3-v1 \
 *     --output data/evals/minimax-m3-holdout.json
 */

import Database from "better-sqlite3";
import path from "path";
import dotenv from "dotenv";
import {
  analyzeBatch,
  buildBatches,
  TIERS,
  tierToPickScore,
  type AnalysisResult,
  type BatchPost,
  type Tier,
  type UsageStats,
} from "../src/lib/ai/llm";
import { BENCHMARK_ENTRIES, type BenchmarkEntry } from "../src/lib/ai/benchmark";
import {
  AUDITED_COMBINED_HOLDOUT_ENTRIES,
  AUDITED_HOLDOUT_ENTRIES,
  AUDITED_RECENT_ENTRIES,
} from "../src/lib/ai/judge-ground-truth";
import { MINIMAX_M3_JUDGE_PROMPT_V3 } from "../src/lib/ai/judge-prompts";
import { loadScreenshot } from "../src/lib/fetchers";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true });

type PromptName = "production" | "minimax-m3-v1" | "minimax-m3-v2" | "minimax-m3-v3";

/** Added after the shared rubric. Production selection remains explicit through environment config. */
const PROMPT_APPENDICES: Record<PromptName, string> = {
  production: "",
  "minimax-m3-v1": `## FINAL TIER DECISION OVERRIDES

Apply this short boundary check after you have identified the project's concrete strengths,
weaknesses, and alternatives. These rules resolve conflicts in the longer guide and take
precedence over a safer middle-tier instinct:

1. PASS OVERRIDES FUNCTIONALITY. A working page is not automatically mid. Use pass when the
   project is a commodity collection duplicated by CyberChef/browser DevTools, a one-form
   utility reproducible in a spreadsheet or paper grid, a prompt/spec instead of a product,
   or a non-project submitted to Show HN. Free, private, no-signup, and clean UI do not rescue
   one of those failure modes. If your own highlight says a spreadsheet, Canva, CyberChef,
   DevToys, or a dominant free tool already covers it with no differentiator, the tier is pass.
2. GEM OVERRIDES FEATURE CHECKLISTS. A verified impossible-seeming constraint with measured
   execution (for example a capable engine in only a few kilobytes) is gem even if it omits
   normal non-core features. A rare collaboration whose story is itself surprising can also
   be gem when paired with a large, measured result. Do not demote either to look cautious.
3. SOLID HAS TWO BOUNDARIES. A finished, specific project with real domain expertise or one
   genuinely interesting angle is solid, not mid, even when personal or niche. Conversely,
   clever implementation in a known, well-served category is usually solid, not banger,
   unless the approach changes what users can do rather than merely reducing setup.
4. Before returning JSON, compare the chosen tier with both adjacent tiers and make the label
   agree with your own highlight and weaknesses. Do not use distribution percentages as a
   quota for this individual project.`,
  "minimax-m3-v2": `## FINAL CLASSIFICATION ALGORITHM — APPLY IN THIS ORDER

The long rubric supplies evidence; this gate sequence supplies the final tier. Do not skip a
gate and do not substitute a nearby safer tier.

GATE 1 — PASS (terminal): Does ANY explicit floor failure apply?
- a generic collection of converters/formatters/calculators already covered by CyberChef,
  browser DevTools, or many free sites, with no chaining or advanced capability;
- a single form, tracker, calendar, or gimmick reproducible with paper or a spreadsheet;
- a prompt, manifesto, list of claims, empty landing page, or non-project in Show HN.
If yes, tier MUST be pass and classification stops. Working code, a clean screenshot,
client-side privacy, free access, and no signup do not change this. "Functional is at least
mid" applies only after every pass failure above is false. If your highlight or weakness names
one of those substitutions and no real differentiator, returning mid contradicts your review.

GATE 2 — GEM (terminal): Is there verified, broadly shareable wow?
- impossible-seeming constraint craft with a measured result; missing ordinary non-core
  features do not cancel the feat; or
- a genuinely rare cross-project collaboration plus a major measured outcome; the surprising
  collaboration story may itself supply the novelty.
If yes, tier MUST be gem. Do not retreat to banger for caution.

GATE 3 — BANGER: Require an interesting idea, strong evidence of execution, and a change in
what is feasible. Deeply porting previously CUDA-only software to consumer hardware counts;
merely making a known inspector easier to start does not.

GATE 4 — SOLID versus MID: One concrete interesting angle is enough for solid. A completed
interactive project grounded in the builder's real domain expertise is solid even if personal
or niche. Do not penalize vanilla JavaScript, lack of a framework, or a small audience by
themselves. Mid means that after removing polish and feature count, no specific interesting
angle remains.

Finally, make the tier agree with your own highlight and weaknesses, and keep the highlight at
15 words or fewer. Distribution percentages are not quotas for an individual project.`,
  "minimax-m3-v3": MINIMAX_M3_JUDGE_PROMPT_V3,
};

type ModelSpec = { provider: string; model: string; raw: string };

function parseModelSpec(raw: string): ModelSpec {
  const separator = raw.indexOf(":");
  if (separator === -1) throw new Error(`Invalid model spec "${raw}"; use provider:model`);
  return {
    provider: raw.slice(0, separator),
    model: raw.slice(separator + 1),
    raw,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: {
    model: string;
    split: "calibration" | "historical" | "recent" | "holdout";
    prompt: PromptName;
    concurrency: number;
    repeats: number;
    batchSize: number;
    maxBatchTokens: number;
    screenshots: boolean;
    routerProvider: string;
    routerFallbacks: boolean;
    structuredOutput: boolean;
    reasoningEffort: "none" | "minimal" | "low" | "medium" | "high";
    temperature: number;
    output?: string;
    limit?: number;
  } = {
    model: "openrouter:minimax/minimax-m3",
    split: "calibration",
    prompt: "production",
    concurrency: 2,
    repeats: 1,
    batchSize: 1,
    maxBatchTokens: 10_000,
    screenshots: true,
    routerProvider: "together",
    routerFallbacks: false,
    structuredOutput: true,
    reasoningEffort: "low",
    temperature: 0,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--model") flags.model = args[++i];
    else if (arg === "--split") {
      const value = args[++i];
      if (!["calibration", "historical", "recent", "holdout"].includes(value)) {
        throw new Error(
          `Invalid --split "${value}"; use calibration, historical, recent, or holdout`,
        );
      }
      flags.split = value as typeof flags.split;
    } else if (arg === "--prompt") {
      const value = args[++i] as PromptName;
      if (!(value in PROMPT_APPENDICES)) {
        throw new Error(`Invalid --prompt "${value}"`);
      }
      flags.prompt = value;
    } else if (arg === "--concurrency") flags.concurrency = Number(args[++i]);
    else if (arg === "--repeats") flags.repeats = Number(args[++i]);
    else if (arg === "--batch-size") flags.batchSize = Number(args[++i]);
    else if (arg === "--max-batch-tokens") flags.maxBatchTokens = Number(args[++i]);
    else if (arg === "--no-screenshots") flags.screenshots = false;
    else if (arg === "--router-provider") flags.routerProvider = args[++i];
    else if (arg === "--allow-router-fallbacks") flags.routerFallbacks = true;
    else if (arg === "--json-mode") flags.structuredOutput = false;
    else if (arg === "--reasoning") {
      const value = args[++i] as typeof flags.reasoningEffort;
      if (!["none", "minimal", "low", "medium", "high"].includes(value)) {
        throw new Error(`Invalid --reasoning "${value}"`);
      }
      flags.reasoningEffort = value;
    }
    else if (arg === "--temperature") flags.temperature = Number(args[++i]);
    else if (arg === "--output") flags.output = args[++i];
    else if (arg === "--limit") flags.limit = Number(args[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(flags.concurrency) || flags.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (!Number.isInteger(flags.repeats) || flags.repeats < 1) {
    throw new Error("--repeats must be a positive integer");
  }
  if (!Number.isInteger(flags.batchSize) || flags.batchSize < 1) {
    throw new Error("--batch-size must be a positive integer");
  }
  if (!Number.isInteger(flags.maxBatchTokens) || flags.maxBatchTokens < 1) {
    throw new Error("--max-batch-tokens must be a positive integer");
  }
  if (!Number.isFinite(flags.temperature) || flags.temperature < 0 || flags.temperature > 2) {
    throw new Error("--temperature must be a number from 0 to 2");
  }
  if (flags.limit !== undefined && (!Number.isInteger(flags.limit) || flags.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  return flags;
}

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db");
const sqlite = new Database(DB_PATH, { readonly: true });

type PostRow = {
  id: number;
  title: string;
  url: string | null;
  story_text: string | null;
  page_content: string | null;
  readme_content: string | null;
};

function fetchRows(ids: number[]): Map<number, PostRow> {
  const placeholders = ids.map(() => "?").join(",");
  const rows = sqlite
    .prepare(
      `SELECT id, title, url, story_text, page_content, readme_content
       FROM posts WHERE id IN (${placeholders})`,
    )
    .all(...ids) as PostRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

function toBatchPost(row: PostRow, screenshots: boolean): BatchPost {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    storyText: row.story_text,
    pageContent:
      row.page_content || row.story_text?.replace(/<[^>]*>/g, " ").slice(0, 3000) || row.title,
    readmeContent: row.readme_content || undefined,
    screenshotBase64: screenshots ? loadScreenshot(row.id) : undefined,
  };
}

type ScoreRecord = {
  postId: number;
  title: string;
  repeat: number;
  expected: Tier;
  actual?: Tier;
  exact: boolean;
  tierDistance?: number;
  signedDelta?: number;
  result?: AnalysisResult;
  usage?: UsageStats;
  estimatedCostUsd: number;
  highlightWords?: number;
  highlightWithinLimit?: boolean;
  completeEditorialFields?: boolean;
  error?: string;
};

const PRICING: Record<string, { input: number; output: number }> = {
  "minimax/minimax-m3": { input: 0.23, output: 0.96 },
  "qwen/qwen3.5-397b-a17b": { input: 0.39, output: 2.34 },
};

function estimatedCost(model: string, usage: UsageStats): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  return (usage.inputTokens * pricing.input + usage.outputTokens * pricing.output) / 1_000_000;
}

function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  async function spin() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, spin));
  return output;
}

function tierIndex(tier: Tier): number {
  return TIERS.indexOf(tier);
}

async function scoreEntries(
  entries: BenchmarkEntry[],
  rows: Map<number, PostRow>,
  spec: ModelSpec,
  flags: ReturnType<typeof parseArgs>,
): Promise<ScoreRecord[]> {
  if (flags.batchSize > 1) {
    if (flags.split === "calibration") {
      throw new Error("Batched calibration cannot preserve leave-one-out examples; use --batch-size 1");
    }

    const entryById = new Map(entries.map((entry) => [entry.postId, entry]));
    const posts = entries.map((entry) => {
      const row = rows.get(entry.postId);
      if (!row) throw new Error(`post ${entry.postId} missing from database`);
      return toBatchPost(row, flags.screenshots);
    });
    const batches = buildBatches(posts, flags.maxBatchTokens, flags.batchSize);
    const work = Array.from({ length: flags.repeats }, (_, repeat) =>
      batches.map((batch) => ({ batch, repeat: repeat + 1 })),
    ).flat();

    const scoredBatches = await runWithConcurrency(
      work,
      flags.concurrency,
      async ({ batch, repeat }): Promise<ScoreRecord[]> => {
        try {
          const { results, usage } = await analyzeBatch(batch, {
            providerOverride: spec.provider,
            modelOverride: spec.model,
            routerProviderOverride:
              spec.provider === "openrouter" ? flags.routerProvider : undefined,
            allowRouterFallbacks: flags.routerFallbacks,
            routerRequireParameters: true,
            routerReasoningEffort: flags.reasoningEffort,
            routerTemperature: flags.temperature,
            structuredOutput: flags.structuredOutput,
            promptAppendix: PROMPT_APPENDICES[flags.prompt] || undefined,
          });

          return batch.map((post, index) => {
            const entry = entryById.get(post.id)!;
            const result = results.get(post.id);
            if (!result) {
              return {
                postId: post.id,
                title: entry.title,
                repeat,
                expected: entry.tier,
                exact: false,
                estimatedCostUsd: 0,
                error: "model response did not include this post",
              };
            }
            const highlightWords = wordCount(result.highlight);
            return {
              postId: post.id,
              title: entry.title,
              repeat,
              expected: entry.tier,
              actual: result.tier,
              exact: result.tier === entry.tier,
              tierDistance: Math.abs(tierIndex(result.tier) - tierIndex(entry.tier)),
              signedDelta: tierToPickScore(result.tier) - tierToPickScore(entry.tier),
              result,
              // Record call-level usage once so batch cost and tokens are not multiplied.
              usage: index === 0 ? usage : undefined,
              estimatedCostUsd: index === 0 ? estimatedCost(spec.model, usage) : 0,
              highlightWords,
              highlightWithinLimit: highlightWords <= 15,
              completeEditorialFields:
                Boolean(result.summary && result.highlight && result.target_audience) &&
                result.strengths.length > 0 &&
                result.weaknesses.length > 0,
            };
          });
        } catch (error) {
          return batch.map((post) => {
            const entry = entryById.get(post.id)!;
            return {
              postId: post.id,
              title: entry.title,
              repeat,
              expected: entry.tier,
              exact: false,
              estimatedCostUsd: 0,
              error: (error as Error).message,
            };
          });
        }
      },
    );
    return scoredBatches.flat();
  }

  const work = Array.from({ length: flags.repeats }, (_, repeat) =>
    entries.map((entry) => ({ entry, repeat: repeat + 1 })),
  ).flat();

  return runWithConcurrency(work, flags.concurrency, async ({ entry, repeat }) => {
    const row = rows.get(entry.postId);
    if (!row) {
      return {
        postId: entry.postId,
        title: entry.title,
        repeat,
        expected: entry.tier,
        exact: false,
        estimatedCostUsd: 0,
        error: "post missing from database",
      };
    }

    try {
      const excludeBenchmarkIds = flags.split === "calibration" ? [entry.postId] : undefined;
      const { results, usage } = await analyzeBatch([toBatchPost(row, flags.screenshots)], {
        providerOverride: spec.provider,
        modelOverride: spec.model,
        routerProviderOverride: spec.provider === "openrouter" ? flags.routerProvider : undefined,
        allowRouterFallbacks: flags.routerFallbacks,
        routerRequireParameters: true,
        routerReasoningEffort: flags.reasoningEffort,
        routerTemperature: flags.temperature,
        structuredOutput: flags.structuredOutput,
        excludeBenchmarkIds,
        promptAppendix: PROMPT_APPENDICES[flags.prompt] || undefined,
      });
      const result = results.get(entry.postId);
      if (!result) throw new Error("model response did not include this post");

      const highlightWords = wordCount(result.highlight);
      return {
        postId: entry.postId,
        title: entry.title,
        repeat,
        expected: entry.tier,
        actual: result.tier,
        exact: result.tier === entry.tier,
        tierDistance: Math.abs(tierIndex(result.tier) - tierIndex(entry.tier)),
        signedDelta: tierToPickScore(result.tier) - tierToPickScore(entry.tier),
        result,
        usage,
        estimatedCostUsd: estimatedCost(spec.model, usage),
        highlightWords,
        highlightWithinLimit: highlightWords <= 15,
        completeEditorialFields:
          Boolean(result.summary && result.highlight && result.target_audience) &&
          result.strengths.length > 0 &&
          result.weaknesses.length > 0,
      };
    } catch (error) {
      return {
        postId: entry.postId,
        title: entry.title,
        repeat,
        expected: entry.tier,
        exact: false,
        estimatedCostUsd: 0,
        error: (error as Error).message,
      };
    }
  });
}

function summarize(records: ScoreRecord[]) {
  const ok = records.filter((record) => !record.error && record.actual);
  const usageRecords = ok.filter((record) => record.usage);
  const exact = ok.filter((record) => record.exact).length;
  const adjacent = ok.filter((record) => (record.tierDistance ?? 99) <= 1).length;
  const totalInputTokens = usageRecords.reduce((sum, record) => sum + record.usage!.inputTokens, 0);
  const totalOutputTokens = usageRecords.reduce((sum, record) => sum + record.usage!.outputTokens, 0);
  const billed = usageRecords.map((record) => record.usage!.billedCostUsd);
  const billedCostUsd = billed.every((cost) => cost !== undefined)
    ? (billed as number[]).reduce((sum, cost) => sum + cost, 0)
    : undefined;
  const estimatedCostUsd = ok.reduce((sum, record) => sum + record.estimatedCostUsd, 0);
  const providerCounts: Record<string, number> = {};
  for (const record of usageRecords) {
    const provider = record.usage!.providerName || "unreported";
    providerCounts[provider] = (providerCounts[provider] || 0) + 1;
  }

  const byExpectedTier: Record<string, { n: number; exact: number }> = {};
  for (const tier of TIERS) byExpectedTier[tier] = { n: 0, exact: 0 };
  for (const record of ok) {
    byExpectedTier[record.expected].n++;
    if (record.exact) byExpectedTier[record.expected].exact++;
  }

  const stability = new Map<number, Set<Tier>>();
  for (const record of ok) {
    const tiers = stability.get(record.postId) || new Set<Tier>();
    tiers.add(record.actual!);
    stability.set(record.postId, tiers);
  }

  return {
    attempted: records.length,
    successful: ok.length,
    errors: records.length - ok.length,
    exactPct: ok.length ? (exact / ok.length) * 100 : 0,
    adjacentPct: ok.length ? (adjacent / ok.length) * 100 : 0,
    meanTierDistance: ok.length
      ? ok.reduce((sum, record) => sum + (record.tierDistance || 0), 0) / ok.length
      : 0,
    meanSignedDelta: ok.length
      ? ok.reduce((sum, record) => sum + (record.signedDelta || 0), 0) / ok.length
      : 0,
    highlightCompliancePct: ok.length
      ? (ok.filter((record) => record.highlightWithinLimit).length / ok.length) * 100
      : 0,
    editorialCompletenessPct: ok.length
      ? (ok.filter((record) => record.completeEditorialFields).length / ok.length) * 100
      : 0,
    totalInputTokens,
    totalOutputTokens,
    billedCostUsd,
    estimatedCostUsd,
    apiCalls: usageRecords.length,
    avgLatencyMs: usageRecords.length
      ? usageRecords.reduce((sum, record) => sum + record.usage!.durationMs, 0) /
        usageRecords.length
      : 0,
    providerCounts,
    byExpectedTier,
    unstablePosts: [...stability.entries()]
      .filter(([, tiers]) => tiers.size > 1)
      .map(([postId, tiers]) => ({ postId, tiers: [...tiers] })),
  };
}

function printRecords(records: ScoreRecord[]) {
  for (const record of records) {
    const mark = record.error ? "ERR" : record.exact ? " OK" : "MISS";
    const actual = record.actual || "error";
    const title = record.title.length > 62 ? `${record.title.slice(0, 59)}...` : record.title;
    console.log(
      `${mark} r${record.repeat} ${record.expected.padEnd(6)} -> ${actual.padEnd(6)} ${record.postId} ${title}`,
    );
    if (record.error) console.log(`     ${record.error}`);
  }
}

async function main() {
  const flags = parseArgs();
  const spec = parseModelSpec(flags.model);
  const sourceEntries =
    flags.split === "calibration"
      ? BENCHMARK_ENTRIES
      : flags.split === "historical"
        ? AUDITED_HOLDOUT_ENTRIES
        : flags.split === "recent"
          ? AUDITED_RECENT_ENTRIES
          : AUDITED_COMBINED_HOLDOUT_ENTRIES;
  const entries = flags.limit ? sourceEntries.slice(0, flags.limit) : sourceEntries;
  const rows = fetchRows(entries.map((entry) => entry.postId));

  const overlap = AUDITED_COMBINED_HOLDOUT_ENTRIES.filter((holdout) =>
    BENCHMARK_ENTRIES.some((calibrator) => calibrator.postId === holdout.postId),
  );
  if (overlap.length) {
    throw new Error(`Holdout leakage: ${overlap.map((entry) => entry.postId).join(", ")}`);
  }

  console.log(`[judge-eval] model=${spec.raw}`);
  console.log(
    `[judge-eval] split=${flags.split} n=${entries.length} repeats=${flags.repeats} prompt=${flags.prompt} screenshots=${flags.screenshots} batchSize=${flags.batchSize} maxBatchTokens=${flags.maxBatchTokens} route=${flags.routerProvider} fallbacks=${flags.routerFallbacks} structured=${flags.structuredOutput} reasoning=${flags.reasoningEffort} temperature=${flags.temperature}`,
  );
  console.log("[judge-eval] ground truth: human rubric audit; no production/Qwen labels used");

  const startedAt = new Date().toISOString();
  const records = await scoreEntries(entries, rows, spec, flags);
  const summary = summarize(records);
  printRecords(records);

  console.log("\n[judge-eval] summary");
  console.log(
    `  exact=${summary.exactPct.toFixed(1)}% adjacent=${summary.adjacentPct.toFixed(1)}% errors=${summary.errors}/${summary.attempted}`,
  );
  console.log(
    `  mean tier distance=${summary.meanTierDistance.toFixed(2)} signed bias=${summary.meanSignedDelta >= 0 ? "+" : ""}${summary.meanSignedDelta.toFixed(2)}`,
  );
  console.log(
    `  highlight<=15=${summary.highlightCompliancePct.toFixed(1)}% complete fields=${summary.editorialCompletenessPct.toFixed(1)}%`,
  );
  console.log(
    `  tokens=${summary.totalInputTokens} in + ${summary.totalOutputTokens} out estimated=$${summary.estimatedCostUsd.toFixed(4)} billed=${summary.billedCostUsd === undefined ? "unreported" : `$${summary.billedCostUsd.toFixed(4)}`}`,
  );
  console.log(
    `  calls=${summary.apiCalls} avg call latency=${(summary.avgLatencyMs / 1000).toFixed(1)}s providers=${JSON.stringify(summary.providerCounts)}`,
  );
  for (const tier of TIERS) {
    const tierSummary = summary.byExpectedTier[tier];
    console.log(`  ${tier.padEnd(6)} ${tierSummary.exact}/${tierSummary.n} exact`);
  }

  if (flags.output) {
    const fs = await import("fs/promises");
    await fs.writeFile(
      flags.output,
      JSON.stringify(
        {
          startedAt,
          completedAt: new Date().toISOString(),
          model: spec.raw,
          split: flags.split,
          prompt: flags.prompt,
          screenshots: flags.screenshots,
          batchSize: flags.batchSize,
          maxBatchTokens: flags.maxBatchTokens,
          routerProvider: flags.routerProvider,
          routerFallbacks: flags.routerFallbacks,
          structuredOutput: flags.structuredOutput,
          reasoningEffort: flags.reasoningEffort,
          temperature: flags.temperature,
          groundTruth: "human-audited rubric labels; production/Qwen judgments excluded",
          summary,
          records,
        },
        null,
        2,
      ),
    );
    console.log(`[judge-eval] wrote ${flags.output}`);
  }
}

main()
  .catch((error) => {
    console.error("[judge-eval] fatal", error);
    process.exitCode = 1;
  })
  .finally(() => sqlite.close());
