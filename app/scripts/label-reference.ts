/**
 * Label a reference set of posts with a strong model, for judging evals.
 *
 * Each post is judged on its own (one post per request) with the production
 * rubric and the same evidence the judge sees, several independent times, so
 * disagreement between runs marks the posts that sit on a tier boundary.
 *
 * Every run is appended to a JSONL file as it completes, so an interrupted run
 * resumes where it stopped. Attempts that produced no label (API error,
 * refusal, truncation, wrong served model) go to a separate errors file and are
 * retried on the next invocation; they never count as a label.
 *
 * Usage:
 *   npx tsx scripts/label-reference.ts \
 *     --cases data/evals/reference-v2-candidates.json \
 *     --output data/evals/reference-v2-labels.jsonl --runs 2
 *   npx tsx scripts/label-reference.ts ... --ids 123 456   # only these posts
 *   npx tsx scripts/label-reference.ts ... --appendix-file notes.txt   # extra guidance after the rubric
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import {
  AnalysisRefusedError,
  AnalysisTruncatedError,
  ANTHROPIC_EFFORTS,
  analyzeBatch,
  TIERS,
  type AnthropicEffort,
  type BatchPost,
  type Tier,
  type UsageStats,
} from "../src/lib/ai/llm";
import { estimateCostUsd } from "../src/lib/ai/pricing";
import { loadScreenshot } from "./lib/screenshot-files";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: {
    cases?: string;
    output?: string;
    model: string;
    effort: AnthropicEffort;
    runs: number;
    concurrency: number;
    ids?: number[];
    limit?: number;
    appendixFile?: string;
  } = { model: "anthropic:claude-fable-5-2", effort: "high", runs: 2, concurrency: 4 };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--cases") flags.cases = args[++i];
    else if (arg === "--output") flags.output = args[++i];
    else if (arg === "--model") flags.model = args[++i];
    else if (arg === "--effort") {
      const value = args[++i] as AnthropicEffort;
      if (!ANTHROPIC_EFFORTS.includes(value)) {
        throw new Error(`Invalid --effort "${value}"; use ${ANTHROPIC_EFFORTS.join(", ")}`);
      }
      flags.effort = value;
    } else if (arg === "--runs") flags.runs = Number(args[++i]);
    else if (arg === "--concurrency") flags.concurrency = Number(args[++i]);
    else if (arg === "--limit") flags.limit = Number(args[++i]);
    else if (arg === "--appendix-file") flags.appendixFile = args[++i];
    else if (arg === "--ids") {
      flags.ids = [];
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) flags.ids.push(Number(args[++i]));
    } else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!flags.cases || !flags.output) throw new Error("--cases and --output are required");
  for (const [name, value] of [["--runs", flags.runs], ["--concurrency", flags.concurrency]] as const) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  }
  const separator = flags.model.indexOf(":");
  if (separator === -1) throw new Error(`Invalid --model "${flags.model}"; use provider:model`);
  return {
    ...flags,
    cases: flags.cases,
    output: flags.output,
    provider: flags.model.slice(0, separator),
    modelId: flags.model.slice(separator + 1),
  };
}

type PostRow = {
  id: number;
  title: string;
  url: string | null;
  story_text: string | null;
  page_content: string | null;
  readme_content: string | null;
};

type LabelRow = {
  postId: number;
  run: number;
  tier: Tier;
  summary: string;
  highlight: string;
  strengths: string[];
  weaknesses: string[];
  model: string;
  effort: AnthropicEffort;
  usage: UsageStats;
  costUsd: number;
  labelledAt: string;
};

function readJsonLines<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

/** Same evidence assembly as eval-judge.ts, so labels and judged runs see identical inputs. */
function toBatchPost(row: PostRow): BatchPost {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    storyText: row.story_text,
    pageContent:
      row.page_content || row.story_text?.replace(/<[^>]*>/g, " ").slice(0, 3000) || row.title,
    readmeContent: row.readme_content || undefined,
    screenshotBase64: loadScreenshot(row.id),
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function spin() {
    while (next < items.length) await worker(items[next++]);
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, spin));
}

async function main() {
  const flags = parseArgs();
  const errorsFile = flags.output.replace(/\.jsonl$/, "") + ".errors.jsonl";

  const allCases = (JSON.parse(fs.readFileSync(flags.cases, "utf8")) as { cases: { postId: number }[] }).cases;
  let postIds = allCases.map((entry) => entry.postId);
  if (flags.ids) {
    const unknown = flags.ids.filter((id) => !postIds.includes(id));
    if (unknown.length) throw new Error(`--ids not in the case file: ${unknown.join(", ")}`);
    postIds = flags.ids;
  }
  if (flags.limit) postIds = postIds.slice(0, flags.limit);

  const sqlite = new Database(
    process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db"),
    { readonly: true },
  );
  const rows = new Map(
    (
      sqlite
        .prepare(
          `SELECT id, title, url, story_text, page_content, readme_content
           FROM posts WHERE id IN (${postIds.map(() => "?").join(",")})`,
        )
        .all(...postIds) as PostRow[]
    ).map((row) => [row.id, row]),
  );
  sqlite.close();
  const missing = postIds.filter((id) => !rows.has(id));
  if (missing.length) throw new Error(`Posts missing from the database: ${missing.join(", ")}`);

  const existing = readJsonLines<LabelRow>(flags.output);
  const done = new Set(existing.map((row) => `${row.postId}:${row.run}`));
  const work = Array.from({ length: flags.runs }, (_, index) => index + 1)
    .flatMap((run) => postIds.map((postId) => ({ postId, run })))
    .filter((item) => !done.has(`${item.postId}:${item.run}`));

  console.log(
    `[label] model=${flags.model} effort=${flags.effort} posts=${postIds.length} runs=${flags.runs} ` +
      `already labelled=${done.size} to do=${work.length} concurrency=${flags.concurrency}`,
  );

  // Optional guidance appended after the base rubric, e.g. an owner preference on one boundary.
  const promptAppendix = flags.appendixFile ? fs.readFileSync(flags.appendixFile, "utf8").trim() : "";
  if (flags.appendixFile) console.log(`[label] appendix: ${flags.appendixFile} (${promptAppendix.length} chars)`);

  const fresh: LabelRow[] = [];
  let failures = 0;
  const startedAt = Date.now();

  await runWithConcurrency(work, flags.concurrency, async ({ postId, run }) => {
    try {
      const { results, usage } = await analyzeBatch([toBatchPost(rows.get(postId)!)], {
        providerOverride: flags.provider,
        modelOverride: flags.modelId,
        anthropicEffort: flags.effort,
        structuredOutput: true,
        // Never the judge's model-specific appendix: only what --appendix-file supplies.
        promptAppendix,
      });
      const result = results.get(postId);
      if (!result) throw new Error("model response did not include this post");
      // A label from a silently substituted model would contaminate the reference set.
      if (usage.servedModel && !usage.servedModel.startsWith(flags.modelId)) {
        throw new Error(`served model ${usage.servedModel} is not ${flags.modelId}`);
      }

      const row: LabelRow = {
        postId,
        run,
        tier: result.tier,
        summary: result.summary,
        highlight: result.highlight,
        strengths: result.strengths,
        weaknesses: result.weaknesses,
        model: usage.servedModel || flags.modelId,
        effort: flags.effort,
        usage,
        costUsd: estimateCostUsd(flags.modelId, usage),
        labelledAt: new Date().toISOString(),
      };
      fs.appendFileSync(flags.output, JSON.stringify(row) + "\n");
      fresh.push(row);
    } catch (error) {
      failures++;
      const kind =
        error instanceof AnalysisRefusedError
          ? "refusal"
          : error instanceof AnalysisTruncatedError
            ? "truncated"
            : "error";
      fs.appendFileSync(
        errorsFile,
        JSON.stringify({ postId, run, kind, error: (error as Error).message, at: new Date().toISOString() }) + "\n",
      );
      console.error(`[label] ${kind} post ${postId} run ${run}: ${(error as Error).message.slice(0, 200)}`);
    }
  });

  // Summary over everything labelled so far for the selected posts.
  const selected = new Set(postIds);
  const all = readJsonLines<LabelRow>(flags.output).filter((row) => selected.has(row.postId));
  const tiersByPost = new Map<number, Tier[]>();
  for (const row of all) tiersByPost.set(row.postId, [...(tiersByPost.get(row.postId) || []), row.tier]);
  const multi = [...tiersByPost.values()].filter((tiers) => tiers.length >= 2);
  const agreeing = multi.filter((tiers) => new Set(tiers).size === 1).length;
  const distribution = Object.fromEntries(
    TIERS.map((tier) => [tier, all.filter((row) => row.tier === tier).length]),
  );

  console.log(`\n[label] labelled rows=${all.length} posts=${tiersByPost.size} failures this run=${failures}`);
  console.log(`[label] tier distribution across runs: ${JSON.stringify(distribution)}`);
  if (multi.length) {
    console.log(
      `[label] runs agree on ${agreeing}/${multi.length} posts (${((agreeing / multi.length) * 100).toFixed(1)}%)`,
    );
  }
  if (fresh.length) {
    const sum = (pick: (row: LabelRow) => number) => fresh.reduce((total, row) => total + pick(row), 0);
    const cost = sum((row) => row.costUsd);
    console.log(
      `[label] this run: ${fresh.length} calls, ` +
        `${sum((row) => row.usage.inputTokens)} fresh in + ${sum((row) => row.usage.cacheReadTokens)} cache-read + ` +
        `${sum((row) => row.usage.cacheCreateTokens)} cache-write, ${sum((row) => row.usage.outputTokens)} out ` +
        `(${sum((row) => row.usage.reasoningTokens ?? 0)} thinking)`,
    );
    console.log(
      `[label] this run: $${cost.toFixed(4)} total, $${(cost / fresh.length).toFixed(4)} per call, ` +
        `avg ${(sum((row) => row.usage.durationMs) / fresh.length / 1000).toFixed(1)}s per call, ` +
        `${((Date.now() - startedAt) / 1000).toFixed(0)}s wall clock`,
    );
  }
  if (failures) console.log(`[label] failed attempts are listed in ${errorsFile}`);
}

main().catch((error) => {
  console.error("[label] fatal", error);
  process.exitCode = 1;
});
