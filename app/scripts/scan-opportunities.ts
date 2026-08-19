/**
 * Tier 1 opportunity scanner — surfaces Show HN posts worth taking a step further.
 *
 * Three pools, each ranked independently:
 *   A. Hidden GitHub gem  — AI-loved open source repo, low stars, HN ignored
 *   B. Live app, no traction — AI-loved live web app (no github), HN ignored
 *   C. Almost broke out  — AI-loved, got some HN attention but didn't go viral
 *
 * Output:
 *   data/opportunities/pool-{a,b,c}-YYYY-MM-DD.json   — full ranked list per pool
 *   data/opportunities/summary-YYYY-MM-DD.md          — top N from each, side-by-side
 *
 * Usage:
 *   npx tsx scripts/scan-opportunities.ts                 # all pools, default top 50/pool
 *   npx tsx scripts/scan-opportunities.ts --pool a        # one pool only
 *   npx tsx scripts/scan-opportunities.ts --top 20        # limit per pool
 *   npx tsx scripts/scan-opportunities.ts --ai-only       # restrict to AI/dev/infra categories
 *   npx tsx scripts/scan-opportunities.ts --no-bubble     # EXCLUDE AI/dev/infra (everything else)
 *   npx tsx scripts/scan-opportunities.ts --no-lang       # drop language/silicon/byte-golf craft demos
 *   npx tsx scripts/scan-opportunities.ts --dry-run       # print top 10, don't write files
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db");
const OUT_DIR = path.join(process.cwd(), "data", "opportunities");

// ─── Rubric ─────────────────────────────────────────────────────────────────

const TIER_WEIGHT: Record<string, number> = { gem: 20, banger: 10 };
const AI_FRIENDLY_CATEGORIES = new Set(["AI/ML", "Developer Tools", "Infrastructure"]);
const CATEGORY_BONUS = 5;

// Language/silicon/byte-golf craft demos — intellectually impressive but
// market-irrelevant. Filter applied via --no-lang.
const LANG_SPECIFIC_TITLE_PATTERNS: RegExp[] = [
  // Project IS a programming language or language tool
  /\b(programming\s+)?language\b/i,
  /\b(compiler|interpreter|transpiler)\b/i,
  /\b(grammar|projector|repl|vm|virtual machine)\b/i,
  /\bdialect\b/i,
  // Niche language ecosystems — niche by audience size
  /\bcommon[\s-]?lisp\b/i,
  /\bbrainfuck\b/i,
  /\bhaskell\b/i,
  /\b(erlang|elixir)\b/i,
  /\bocaml\b/i,
  /\bsmalltalk\b/i,
  /\bforth\b/i,
  /\bprolog\b/i,
  /\bscheme\b/i,
  /\bracket\b/i,
  // Hardware / silicon — high barrier, tiny audience
  /\bfpga\b/i,
  /\bverilog\b/i,
  /\bsystemverilog\b/i,
  /\bvhdl\b/i,
  /\bsky130\b/i,
  /\btiny\s+tapeout\b/i,
  /\bsilicon\b/i,
  /\b(asic|risc-?v|tpu|npu)\b/i,
  // Byte-golf / assembly craft demos — performance flex, not product
  /\b\d+\s?(bytes?|kb|kib)\b.*\b(binary|asm|assembly|core|kernel|vm|os)\b/i,
  /\b(in|of)\s+(x86|x86-64|arm|assembly|asm)\b/i,
  /\b6502\b/i,
];

const LANG_SPECIFIC_GH_LANGUAGES = new Set([
  "Assembly",
  "Common Lisp",
  "Lisp",
  "Scheme",
  "Racket",
  "Haskell",
  "OCaml",
  "Erlang",
  "Elixir",
  "Forth",
  "Prolog",
  "Smalltalk",
  "Verilog",
  "SystemVerilog",
  "VHDL",
  "Brainfuck",
  "Coq",
  "Idris",
  "Agda",
]);

function isLangSpecific(p: PostRow): boolean {
  if (p.github_language && LANG_SPECIFIC_GH_LANGUAGES.has(p.github_language)) return true;
  for (const pat of LANG_SPECIFIC_TITLE_PATTERNS) {
    if (pat.test(p.title)) return true;
  }
  return false;
}

function scorePost(p: PostRow, opts: { aiOnly: boolean }): number {
  const tierScore = TIER_WEIGHT[p.tier] ?? 0;
  const engagement = Math.min(p.comments ?? 0, 20) * 0.5;
  const attentionPenalty = 3 * Math.log10(Math.max(p.points ?? 0, 1));
  const competitionPenalty = 2 * Math.log10(Math.max(p.github_stars ?? 0, 1));
  const ageBonus = Math.min(p.age_days / 30, 6) * 1.0;
  const catBonus = AI_FRIENDLY_CATEGORIES.has(p.category ?? "") ? CATEGORY_BONUS : 0;

  // When --ai-only, the category filter is hard, so the bonus is moot
  return Number(
    (
      tierScore +
      engagement -
      attentionPenalty -
      competitionPenalty +
      ageBonus +
      (opts.aiOnly ? 0 : catBonus)
    ).toFixed(2),
  );
}

// ─── Pool definitions ───────────────────────────────────────────────────────

type PoolKey = "a" | "b" | "c";
type Pool = { key: PoolKey; name: string; tagline: string; where: string };

const POOLS: Pool[] = [
  {
    key: "a",
    name: "Hidden GitHub gem",
    tagline: "AI-loved open source, obscure at submission, HN ignored",
    where: `
      a.tier IN ('gem','banger')
      AND p.github_stars IS NOT NULL
      AND p.github_stars < 50
      AND p.points <= 5
      AND p.status = 'active'
      AND (strftime('%s','now') - p.created_at) >= 21 * 86400
    `,
  },
  {
    key: "b",
    name: "Live app, no traction",
    tagline: "AI-loved live web app (no repo), HN ignored",
    where: `
      a.tier IN ('gem','banger')
      AND p.url IS NOT NULL
      AND p.github_stars IS NULL
      AND p.points <= 5
      AND p.status = 'active'
      AND (strftime('%s','now') - p.created_at) >= 21 * 86400
    `,
  },
  {
    key: "c",
    name: "Almost broke out",
    tagline: "AI-loved, got some HN attention but didn't go viral",
    where: `
      a.tier IN ('gem','banger')
      AND p.points BETWEEN 10 AND 50
      AND p.status = 'active'
      AND (strftime('%s','now') - p.created_at) >= 30 * 86400
    `,
  },
];

// ─── Types ──────────────────────────────────────────────────────────────────

type PostRow = {
  id: number;
  title: string;
  url: string | null;
  author: string;
  points: number;
  comments: number;
  created_at: number;
  github_stars: number | null;
  github_language: string | null;
  status: string;
  tier: string;
  category: string | null;
  summary: string | null;
  strengths_json: string | null;
  weaknesses_json: string | null;
  vibe_tags_json: string | null;
  similar_to_json: string | null;
  age_days: number;
};

type Output = {
  id: number;
  title: string;
  url: string | null;
  author: string;
  score: number;
  signal: {
    tier: string;
    points: number;
    comments: number;
    github_stars: number | null;
    github_language: string | null;
    age_days: number;
    category: string | null;
  };
  ai_view: {
    summary: string | null;
    strengths: string[];
    weaknesses: string[];
    vibe_tags: string[];
    similar_to: string[];
  };
  links: {
    hn: string;
    site: string | null;
  };
};

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: {
    pool?: PoolKey;
    top: number;
    aiOnly: boolean;
    noBubble: boolean;
    noLang: boolean;
    dryRun: boolean;
  } = { top: 50, aiOnly: false, noBubble: false, noLang: false, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--pool") flags.pool = args[++i] as PoolKey;
    else if (a === "--top") flags.top = Number(args[++i]);
    else if (a === "--ai-only") flags.aiOnly = true;
    else if (a === "--no-bubble") flags.noBubble = true;
    else if (a === "--no-lang") flags.noLang = true;
    else if (a === "--dry-run") flags.dryRun = true;
  }
  if (flags.aiOnly && flags.noBubble) {
    console.error("--ai-only and --no-bubble are mutually exclusive");
    process.exit(1);
  }
  return flags;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeJsonArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function toOutput(row: PostRow, score: number): Output {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    author: row.author,
    score,
    signal: {
      tier: row.tier,
      points: row.points,
      comments: row.comments,
      github_stars: row.github_stars,
      github_language: row.github_language,
      age_days: row.age_days,
      category: row.category,
    },
    ai_view: {
      summary: row.summary,
      strengths: safeJsonArray(row.strengths_json),
      weaknesses: safeJsonArray(row.weaknesses_json),
      vibe_tags: safeJsonArray(row.vibe_tags_json),
      similar_to: safeJsonArray(row.similar_to_json),
    },
    links: {
      hn: `https://news.ycombinator.com/item?id=${row.id}`,
      site: row.url,
    },
  };
}

function queryPool(
  db: Database.Database,
  pool: Pool,
  aiOnly: boolean,
  noBubble: boolean,
): PostRow[] {
  const aiClause = aiOnly
    ? `AND a.category IN ('AI/ML','Developer Tools','Infrastructure')`
    : noBubble
      ? `AND a.category NOT IN ('AI/ML','Developer Tools','Infrastructure')`
      : "";
  const sql = `
    SELECT
      p.id, p.title, p.url, p.author, p.points, p.comments, p.created_at,
      p.github_stars, p.github_language, p.status,
      a.tier, a.category, a.summary,
      a.strengths AS strengths_json,
      a.weaknesses AS weaknesses_json,
      a.vibe_tags AS vibe_tags_json,
      a.similar_to AS similar_to_json,
      CAST((strftime('%s','now') - p.created_at) / 86400 AS INT) AS age_days
    FROM posts p
    JOIN ai_analysis a ON a.post_id = p.id
    WHERE ${pool.where}
      ${aiClause}
  `;
  return db.prepare(sql).all() as PostRow[];
}

// ─── Markdown summary ───────────────────────────────────────────────────────

function renderMarkdownEntry(o: Output): string {
  const stars = o.signal.github_stars != null ? `★${o.signal.github_stars}` : "—";
  const lang = o.signal.github_language ?? "";
  const cat = o.signal.category ?? "";
  const tier = o.signal.tier.toUpperCase();
  const ageWeeks = Math.floor(o.signal.age_days / 7);
  const url = o.url ? ` · [site](${o.url})` : "";
  const strengths = o.ai_view.strengths.slice(0, 3).join(" · ");
  const weaknesses = o.ai_view.weaknesses.slice(0, 2).join(" · ");

  return [
    `### ${o.score} — ${o.title}`,
    `[${tier}] · ${o.signal.points}pts · ${o.signal.comments}c · ${stars} ${lang} · ${cat} · ${ageWeeks}w old`,
    `[hn](${o.links.hn})${url}`,
    o.ai_view.summary ? `> ${o.ai_view.summary}` : "",
    strengths ? `**Strengths:** ${strengths}` : "",
    weaknesses ? `**Weaknesses:** ${weaknesses}` : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderMarkdown(
  results: { pool: Pool; outputs: Output[] }[],
  topN: number,
  aiOnly: boolean,
  noBubble: boolean,
  noLang: boolean,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Show HN Opportunity Scan — ${today}`);
  lines.push("");
  const filters = [
    aiOnly
      ? "AI/ML + Developer Tools + Infrastructure only"
      : noBubble
        ? "AI/dev/infra EXCLUDED — everything else"
        : "all categories",
    noLang ? "language/silicon/byte-golf craft demos filtered out" : null,
  ]
    .filter(Boolean)
    .join("; ");
  lines.push(`Filter: ${filters}. Top ${topN} per pool.`);
  lines.push("");
  lines.push(`**Rubric:** tier(gem=20,banger=10) + min(comments,20)*0.5 − 3·log10(points) − 2·log10(stars) + min(age/30,6) + AI-cat bonus`);
  lines.push("");

  for (const { pool, outputs } of results) {
    lines.push(`## Pool ${pool.key.toUpperCase()} — ${pool.name}`);
    lines.push(`*${pool.tagline}* · ${outputs.length} candidates total`);
    lines.push("");
    if (outputs.length === 0) {
      lines.push("_No candidates._");
      lines.push("");
      continue;
    }
    for (const o of outputs.slice(0, topN)) {
      lines.push(renderMarkdownEntry(o));
    }
  }
  return lines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const flags = parseArgs();
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma("journal_mode = WAL");

  const pools = flags.pool ? POOLS.filter((p) => p.key === flags.pool) : POOLS;
  if (pools.length === 0) {
    console.error(`No matching pool: ${flags.pool}`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  if (!flags.dryRun) fs.mkdirSync(OUT_DIR, { recursive: true });

  const results: { pool: Pool; outputs: Output[] }[] = [];

  for (const pool of pools) {
    const rawRows = queryPool(db, pool, flags.aiOnly, flags.noBubble);
    const rows = flags.noLang ? rawRows.filter((r) => !isLangSpecific(r)) : rawRows;
    const droppedLang = rawRows.length - rows.length;
    const scored = rows
      .map((r) => toOutput(r, scorePost(r, { aiOnly: flags.aiOnly })))
      .sort((a, b) => b.score - a.score);

    results.push({ pool, outputs: scored });

    console.log(
      `\n=== Pool ${pool.key.toUpperCase()} — ${pool.name} ===`,
    );
    console.log(`${pool.tagline}`);
    console.log(
      `Candidates: ${scored.length}` +
        (flags.noLang ? ` (filtered ${droppedLang} lang/silicon/byte-golf)` : ""),
    );

    const preview = scored.slice(0, flags.dryRun ? 10 : 5);
    for (const o of preview) {
      const stars = o.signal.github_stars != null ? `★${o.signal.github_stars}` : "—";
      console.log(
        `  ${o.score.toString().padStart(6)} ${o.signal.tier.padEnd(6)} ${o.signal.points.toString().padStart(3)}pt ${stars.padEnd(6)} ${o.title.slice(0, 80)}`,
      );
    }

    if (!flags.dryRun) {
      const suffix =
        (flags.aiOnly ? "-ai" : "") +
        (flags.noBubble ? "-nobubble" : "") +
        (flags.noLang ? "-nolang" : "");
      const jsonPath = path.join(OUT_DIR, `pool-${pool.key}-${today}${suffix}.json`);
      fs.writeFileSync(
        jsonPath,
        JSON.stringify(
          { generated_at: new Date().toISOString(), pool: pool.name, tagline: pool.tagline, count: scored.length, results: scored },
          null,
          2,
        ),
      );
      console.log(`  → ${jsonPath}`);
    }
  }

  if (!flags.dryRun) {
    const md = renderMarkdown(results, flags.top, flags.aiOnly, flags.noBubble, flags.noLang);
    const suffix =
      (flags.aiOnly ? "-ai" : "") +
      (flags.noBubble ? "-nobubble" : "") +
      (flags.noLang ? "-nolang" : "");
    const mdPath = path.join(OUT_DIR, `summary-${today}${suffix}.md`);
    fs.writeFileSync(mdPath, md);
    console.log(`\nSummary: ${mdPath}`);
  } else {
    console.log("\n(dry-run: no files written)");
  }

  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
