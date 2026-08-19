/**
 * Configurable LLM client — supports OpenAI and Anthropic.
 * Controlled via ANALYSIS_PROVIDER and ANALYSIS_MODEL env vars.
 *
 * Rating system: tier classification + playful vibe tags + editorial highlight.
 * No numeric sub-scores shown to users — the written highlight is the star.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { buildBenchmarkContext } from "./benchmark";
import { getJudgePromptAppendix } from "./judge-prompts";

export const TIERS = ["gem", "banger", "solid", "mid", "pass"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  gem: "Gem",
  banger: "Banger",
  solid: "Solid",
  mid: "Mid",
  pass: "Pass",
};

export const TIER_DOTS: Record<Tier, string> = {
  gem: "●●●●",
  banger: "●●●",
  solid: "●●",
  mid: "●",
  pass: "○",
};

/** Fixed pick_score per tier — used for DB sorting only */
const TIER_SCORES: Record<Tier, number> = {
  gem: 95,
  banger: 80,
  solid: 65,
  mid: 50,
  pass: 35,
};

export const VIBE_TAGS = [
  "Rabbit Hole",
  "Dark Horse",
  "Eye Candy",
  "Wizardry",
  "Big Brain",
  "Crowd Pleaser",
  "Niche Gem",
  "Bold Bet",
  "Ship It",
  "Zero to One",
  "Cozy",
  "Slick",
  "Solve My Problem",
] as const;

export type VibeTag = (typeof VIBE_TAGS)[number];

/** Semantic colors for each vibe tag — light + dark mode bg/text/border classes */
export const VIBE_TAG_COLORS: Record<string, string> = {
  "Wizardry":         "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-700",
  "Eye Candy":        "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-900/40 dark:text-pink-300 dark:border-pink-700",
  "Big Brain":        "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700",
  "Crowd Pleaser":    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700",
  "Niche Gem":        "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700",
  "Bold Bet":         "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700",
  "Ship It":          "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-700",
  "Zero to One":      "bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/40 dark:text-cyan-300 dark:border-cyan-700",
  "Cozy":             "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700",
  "Slick":            "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-700",
  "Solve My Problem": "bg-lime-100 text-lime-700 border-lime-200 dark:bg-lime-900/40 dark:text-lime-300 dark:border-lime-700",
  "Rabbit Hole":      "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-700",
  "Dark Horse":       "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-600",
};

const VIBE_TAG_FALLBACK = "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800/40 dark:text-zinc-400 dark:border-zinc-700";

export function getVibeTagColor(tag: string): string {
  return VIBE_TAG_COLORS[tag] || VIBE_TAG_FALLBACK;
}

export type AnalysisResult = {
  summary: string;
  category: string;
  target_audience: string;
  tier: Tier;
  vibe_tags: string[];
  highlight: string;
  strengths: string[];
  weaknesses: string[];
  similar_to: string[];
  pick_reason: string;
};

/** Token usage stats returned from provider calls */
export type UsageStats = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;   // Anthropic prompt cache hits (0 for OpenAI)
  cacheCreateTokens: number; // Anthropic prompt cache writes (0 for OpenAI)
  durationMs: number;
  /** OpenRouter endpoint that actually served the request, when reported. */
  providerName?: string;
  /** Billed request cost reported by OpenRouter, when available. */
  billedCostUsd?: number;
  reasoningTokens?: number;
  finishReason?: string;
  nativeFinishReason?: string;
};

type ProviderResponse = {
  text: string;
  usage: UsageStats;
};

const CATEGORIES = [
  "AI/ML",
  "Developer Tools",
  "SaaS",
  "Open Source",
  "Hardware",
  "Design",
  "Productivity",
  "Finance",
  "Health",
  "Education",
  "Social",
  "Gaming",
  "Security",
  "Data",
  "Infrastructure",
  "Other",
];

/** Static system prompt — includes benchmark calibration. Cached by Anthropic.
 *  excludeBenchmarkIds: leave-one-out support for eval — omit these posts from calibration. */
function buildSystemPrompt(excludeBenchmarkIds?: number[], promptAppendix?: string): string {
  const benchmark = buildBenchmarkContext(excludeBenchmarkIds);
  return `You're a sharp, opinionated tech writer reviewing Show HN projects. Analyze the project provided and return a JSON object.

Return ONLY a JSON object with these fields:
{
  "summary": "One sentence for link previews: what this project does, plain and specific (no opinions)",
  "category": "One of: ${CATEGORIES.join(", ")}",
  "target_audience": "Who would use this (e.g. 'Backend developers', 'Small business owners')",
  "tier": "gem | banger | solid | mid | pass",
  "vibe_tags": ["1-3 tags from the allowed list below"],
  "highlight": "One punchy sentence, MAX 15 words. Hook or dismiss. Name a specific feature or competitor.",
  "strengths": ["1-3 bullets, ~12 words each: what's genuinely clever, useful, or well-built"],
  "weaknesses": ["1-2 bullets, ~12 words each: what's missing, limiting, or already solved elsewhere"],
  "similar_to": ["1-3 existing tools or products this competes with or closely resembles. Empty array if truly novel."]
}

CALIBRATION DISCIPLINE — before reading the tier guide, internalize this:
  The full distribution is gem 2-4% / banger 16% / solid 47% / mid 31% / pass 4%.
  Calibration errors run in BOTH directions:
  - Compression error: hedging away from gem and pass into the safe middle.
    When a project gives a clear gem signal, name it gem — don't retreat to banger.
    When a project has no substance, name it pass — don't promote to mid.
  - Inflation error: pushing solid up to banger or mid up to solid because you
    feel cautious about being harsh. Solid is the honest median. If a project
    is competently built but doesn't make you say "oh that's cool," it's solid
    — promoting it to banger to seem generous is also a calibration error.
  Use the rubric to find the right tier. Don't retreat to the middle, but
  don't drift up to seem charitable either.

TIER GUIDE — read all five before deciding.
  gem:    The best of Show HN — you'd send this link to a friend unprompted. Novel concept
          or approach, strong execution, and genuine "wow" factor. Expect roughly 2-4% of
          projects to be gems. If a project makes you think "this is special" or "why didn't
          this exist before?" — trust that instinct and give it gem. Don't second-guess upward.
          Gem vs banger: gem makes you think "I have to share this" — banger makes you think
          "neat, that's well-done." If you're tempted to call banger but the project (a) does
          something nobody tried before, (b) hits a "constraint craft" mark like fitting an
          impossible thing in an impossible space, or (c) tells a story that itself is the
          wow (rare collaborations, single-person feats, niche hardware) — that's gem, not banger.
  banger: Clear "oh that's cool" moment that most developers would appreciate. Needs both
          an interesting idea AND strong execution — not either/or. The project must do
          something that isn't already well-served by established tools in the space.
          A complex architecture on a common problem is not enough — sophistication is
          expected, not a differentiator. If you've seen three similar tools this week
          on HN, it's solid no matter how well-built this one is.
  solid:  Competent project with at least one interesting angle — a clever technique, a
          fresh take on the problem, or a notably well-crafted implementation. You'd use
          it if you had the problem but wouldn't go out of your way to tell someone.
          If you can't name one specific thing that's *interesting*, it's mid.
  mid:    Works but doesn't stand out. Applies to: derivative idea where a well-known tool
          already does this, unremarkable execution, crowded category with no clear
          differentiation, or an embryonic product competing against established tools.
          A README full of buzzwords without matching implementation quality belongs here.
          Most "yet another X" projects belong here, even if competently built.
          Mid is not an insult — it's the honest middle of the bell curve.
          Mid vs pass: mid means it works but isn't interesting. Pass means there's no
          substance to evaluate at all. If the project is functional and you can describe
          what it does, it's at minimum mid. Pass is reserved for the failure modes below.
  pass:   No substance. Generic, broken, tutorial-level clone, empty landing page, blog
          post masquerading as a product, or a feature count without real depth (e.g. "100+
          tools" that each wrap a library function). Pass also covers: spec/manifesto with
          no shipped code, opinion piece submitted to wrong venue, single-gimmick utility
          a spreadsheet replicates, or commodity clone of a free dominant alternative
          (CyberChef, browser DevTools, Google Sheets). If the project triggers any of these
          patterns, name it pass — don't promote to mid because the work "exists."

COMMON FALSE POSITIVES — these look like bangers but aren't:
  Complex architecture, crowded category → solid:
    "CodeGraph CLI" — tree-sitter AST + SQLite graph + vector embeddings + multi-agent
    tools for codebase Q&A. Sounds impressive, but "chat with your codebase" has dozens
    of tools (Cursor, Continue, Sourcegraph Cody, etc.). Layering more tech onto a
    solved problem isn't a "cool moment" — it's table stakes. Solid.
  Orchestration of existing tools → solid:
    "tspub" — bundles esbuild, type-checking, and npm publish into one CLI with
    validation gates and auto-rollback. Useful, genuinely good DX — but it's wiring
    together things that already exist. Nobody would text this to a friend. Solid.
  AI-adjacent wrapper → solid:
    "iherb-CLI" — headless Chrome scraping a supplement store, outputs markdown for
    LLM agents. Smart hack, but it's a scraper for one website. "AI-optimized" doesn't
    automatically upgrade the tier. Solid.
  Pretty product in a crowded space → solid:
    "Palettepoint.com" — AI color palettes from text descriptions or images, with CSS
    and Tailwind export. Clean, but Coolors, Adobe Color, Khroma and several AI
    alternatives already exist. Nice product, no differentiator. Solid.
  Fun novelty, no staying power → solid:
    "Google Maps in Your Terminal" — renders vector tiles as ASCII art, searchable and
    pannable. Technically neat and fun to poke at for five minutes, but it's a novelty
    with no real use case. If your own honest take includes "mostly a novelty," that's
    solid, not banger.
  Your own review undermines the tier → downgrade:
    If your highlight says "needs more examples," "unclear implementation," "will depend
    on adoption," or "more of an experiment" — trust your own caveats. A project that
    needs caveats in every sentence isn't giving you an "oh that's cool" moment.

SOLID vs MID — many projects rated solid should actually be mid. Ask: "does this project
have at least one interesting idea or angle, even if niche?" If yes, solid. If it's
competent but you can't name a single thing that's *interesting* about it, that's mid.
  These look like solids but are actually mid:
  Free/no-signup clone of an established tool → mid:
    "AI Background Remover" — no signup, no watermarks, runs in browser. Clean UX, but
    remove.bg, PhotoRoom, and a dozen clones already do this. Being free doesn't make
    an idea interesting. Mid.
  Boilerplate / starter kit / reference implementation → mid:
    "Production-Ready NestJS Back End" — multi-tenancy, event-driven, OpenTelemetry.
    These are standard patterns for SaaS backends. A well-organized teaching repo is
    not a product — it's a template. Mid.
  GUI wrapper around a CLI tool → mid:
    "Macabolic" — native macOS UI for yt-dlp. SwiftUI + Menu Bar mode is nice, but
    yt-dlp does the work. Wrapping an existing tool in a GUI is expected, not
    interesting. Mid.
  Curated list / directory / collection → mid:
    "Shopify Sections" — drop-in Liquid components for Shopify themes. Useful, but
    it's a collection of boilerplate. No novel technique, no "oh cool" moment. Mid.
  Calculator / single-page utility → mid:
    "How Much Ad Money Targets You" — enter your age, get a dollar estimate. Viral
    landing page, but there's no depth, no tool, no technology worth discussing. Mid.

BANGER vs SOLID — the "would you text this?" test:
  Ask yourself: "Would a dev text this link to a friend?" If the honest answer is
  "probably not, but I'd bookmark it" — that's solid. If you'd genuinely say "check
  this out" — that's banger. The bar is enthusiasm, not utility.
  AI projects specifically: Most AI wrappers are mid. An AI project needs at least
  one of these to be banger: novel architecture (not just chaining APIs), meaningfully
  better than the obvious alternative, or solving a problem that wasn't solvable before
  AI. "Uses GPT to do X" is not automatically interesting. "Runs entirely local with
  custom fine-tuned model" might be.

AI/AGENT BANGERS — these specifically deserve banger, not solid:
  Local-first AI infra: AI that runs on the user's hardware (phone, browser, edge
    device) when the dominant alternative is cloud-only. Off-Grid AI on iOS, Gemma
    running in Chrome with WebGPU + DOM tools — bangers because they invert the
    default deployment assumption.
  Identity/architecture-novel networking AI tools: VPN/proxy tools where the
    novelty is the architecture (identity-based access control, mesh-style routing)
    not the feature list. Pangolin-style identity VPNs — banger.
  Educational AI/system tools that teach by doing: in-browser GPU builders,
    interactive transformer visualizers, neural-network playgrounds that actually
    run. Craft + pedagogical value combine into banger when execution is real.
  AI agent infra that solves a real coordination problem: MCP servers,
    inter-agent protocols, agent debugging tools — banger when there's a clear
    "this enables a thing that wasn't possible" claim.
  Default rule still applies: solo "uses GPT-4 to do X" wrapper is mid. Banger
  requires real architectural or distributional novelty, not an AI label on a
  solved problem.

COMMON FALSE NEGATIVES — these look like solids/bangers but deserve higher:
  Niche tool with genuinely clever approach → banger (not solid):
    "sql.js-httpvfs" — runs SQLite in the browser over HTTP range requests. Niche use
    case, but the approach is genuinely inventive — lazy-loading a DB over a CDN with
    no server. That's an "oh cool" moment even if you'd never use it yourself. Banger.
  Impressive constraint or craft → gem (not banger):
    A chess engine that fits in 2KB, or a full OS in a bootloader. The technical
    constraint forces genuine ingenuity. You'd share this with anyone into programming,
    not just domain experts. That's the gem test — transcends its niche. Gem.
  Solves a painful problem elegantly → gem (not banger):
    An open-source tool that replaces a paid service with better DX. "Why didn't this
    exist?" + polished enough to use today = gem. You don't need groundbreaking CS
    research — a well-chosen problem with excellent execution is enough.

VIBE TAGS — pick 1-3 that genuinely fit from this list (don't force them):
  "Rabbit Hole"      — You'll lose hours exploring this
  "Dark Horse"       — Surprisingly good, flies under the radar
  "Eye Candy"        — Beautiful design or visual experience
  "Wizardry"         — Impressive technical feat, "how did they do that?"
  "Big Brain"        — Clever, non-obvious approach to the problem
  "Crowd Pleaser"    — Broad appeal, everyone will want to try it
  "Niche Gem"        — Perfect for its specific audience
  "Bold Bet"         — Ambitious swing, respect the attempt
  "Ship It"          — MVP energy, early but promising
  "Zero to One"      — Genuinely new thing, didn't exist before
  "Cozy"             — Small, delightful, well-crafted
  "Slick"            — Polished, feels like a real product
  "Solve My Problem" — Immediately useful, fills a real gap

HIGHLIGHT — ONE short sentence. HARD MAX 15 words (~80 characters). This is a card label, not a review.
  Strengths/weaknesses carry the detail — the highlight is just a hook or a dismissal.
  Rules:
  - HARD LIMIT: 15 words. If your sentence has 16+ words, shorten it. Count before returning.
  - NEVER start with "A [adjective] [noun] that..."
  - One idea only. No dashes, semicolons, or "but" clauses.
  - Name a specific feature, technique, or competitor.
  - For mid/pass: be direct about why.
  Voice: sharp, opinionated, like a text message.
  BANNED phrases: "polished", "well-executed", "addresses a clear need", "fills a real gap",
  "production-ready", "developer-focused", "seamlessly", "thoughtful", "leverages".
  Good (11w): "Pixel-accurate Win98 nostalgia that somehow runs real sites inside it."
  Good (12w): "HTML-to-Markdown for LLMs when JinaAI and Firecrawl already exist."
  Good (8w):  "Yet another auth wrapper, but this one's free."
  Bad (22w):  "Clever integration of Git worktrees with Niri workspaces, but the audience is tiny — only matters if you're already using both."

Don't penalize good enterprise/infra projects — a well-built database tool solving real
pain is a banger even if it's not "fun."

SUMMARY — one sentence, plain and specific. This appears in link previews and search results.
  Rules:
  - Describe what it DOES, not what it IS. "Converts PDFs to structured markdown" not
    "A PDF conversion tool."
  - No opinions, no adjectives like "powerful" or "innovative." Save that for the highlight.
  - Include the key technology or approach if non-obvious. "Uses tree-sitter to parse
    code into a queryable graph" is better than "Analyzes codebases."
  - Max ~20 words. If you need more, you're overexplaining.

STRENGTHS/WEAKNESSES — be concrete, not generic.
  Bad strength: "Clean, well-organized codebase" — you can't verify this from a README.
  Good strength: "Wire-protocol parsing means zero code changes to existing apps."
  Bad weakness: "Could benefit from more documentation" — this applies to everything.
  Good weakness: "No Windows support, and the CLI has no --help flag."
  Name specific features, technologies, or missing capabilities. Every bullet should
  contain a noun that's unique to THIS project.

SIMILAR_TO — name real, specific products. Not categories.
  Good: ["Tailscale", "ZeroTier", "WireGuard"]
  Bad: ["other VPN tools", "networking solutions"]
  Empty array [] is fine for genuinely novel projects. Don't force weak comparisons.

Be concise. Return ONLY valid JSON, no markdown fencing.

${benchmark}${promptAppendix ? `\n\n${promptAppendix.trim()}` : ""}`;
}

function optionalBooleanEnv(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return undefined;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be true or false`);
}

function optionalNumberEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function optionalReasoningEffortEnv(): "none" | "minimal" | "low" | "medium" | "high" | undefined {
  const value = process.env.ANALYSIS_REASONING_EFFORT?.trim();
  if (!value) return undefined;
  if (!["none", "minimal", "low", "medium", "high"].includes(value)) {
    throw new Error("ANALYSIS_REASONING_EFFORT must be none, minimal, low, medium, or high");
  }
  return value as "none" | "minimal" | "low" | "medium" | "high";
}


async function callOpenAI(
  systemPrompt: string,
  content: OpenAI.ChatCompletionContentPart[],
  model: string
): Promise<ProviderResponse> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const start = Date.now();

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    max_completion_tokens: 4000,
    response_format: { type: "json_object" },
  });

  return {
    text: response.choices[0]?.message?.content || "",
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      durationMs: Date.now() - start,
    },
  };
}

async function callAnthropic(
  systemPrompt: string,
  content: Anthropic.Messages.ContentBlockParam[],
  model: string,
  prefill?: string
): Promise<ProviderResponse> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const start = Date.now();

  // System prompt with cache_control for Anthropic prompt caching.
  // ~4096 tokens — at Haiku 4.5's minimum. Cache hits save ~90% on prompt tokens.
  const system: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } } as Anthropic.Messages.TextBlockParam,
  ];

  // Prefill assistant turn to steer JSON output (Anthropic has no JSON mode).
  const assistantPrefill = prefill || "{";
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    system,
    messages: [
      { role: "user", content },
      { role: "assistant", content: assistantPrefill },
    ],
  });

  const block = response.content[0];
  const text = block.type === "text" ? `${assistantPrefill}${block.text}` : "";
  const u = response.usage;

  return {
    text,
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: (u as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
      cacheCreateTokens: (u as unknown as Record<string, number>).cache_creation_input_tokens ?? 0,
      durationMs: Date.now() - start,
    },
  };
}

async function callOpenRouter(
  systemPrompt: string,
  content: OpenAI.ChatCompletionContentPart[],
  model: string,
  routerProviderOverride?: string,
  allowFallbacks?: boolean,
  requireParameters?: boolean,
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high",
  responseSchema?: Record<string, unknown>,
  temperature?: number,
): Promise<ProviderResponse> {
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });
  const start = Date.now();

  // Provider routing: pin for production stability (Qwen on Alibaba). Eval can
  // override per-call when comparing models that aren't on the same provider.
  const pinnedProvider = routerProviderOverride ?? process.env.OPENROUTER_PROVIDER ?? "alibaba";
  const providerCfg = pinnedProvider === "auto" && !requireParameters
    ? undefined
    : {
        ...(pinnedProvider === "auto" ? {} : { order: [pinnedProvider] }),
        allow_fallbacks: !!allowFallbacks,
        ...(requireParameters ? { require_parameters: true } : {}),
      };

  const responseFormat = responseSchema
    ? {
        type: "json_schema" as const,
        json_schema: {
          name: "show_hn_analysis",
          strict: true,
          schema: responseSchema,
        },
      }
    : { type: "json_object" as const };

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    // OpenRouter exposes this as max_tokens across providers. Using
    // max_completion_tokens prevents require_parameters routing from matching
    // otherwise compatible open-model endpoints.
    max_tokens: 8000,
    ...(temperature !== undefined ? { temperature } : {}),
    // Force JSON-only output. Some models (Qwen 3.6 series) drop the leading `{`
    // without this. OpenRouter forwards response_format to providers that support it.
    response_format: responseFormat,
    ...((reasoningEffort
      ? { reasoning: { effort: reasoningEffort, exclude: true } }
      : {}) as Record<string, unknown>),
    // OpenRouter-specific provider routing (not in OpenAI types)
    ...((providerCfg ? { provider: providerCfg } : {}) as Record<string, unknown>),
  });

  // OpenRouter returns prompt_tokens_details.cached_tokens for providers that
  // support implicit caching. Many Qwen endpoints (Alibaba in particular) do
  // NOT support caching — these stay 0 and we pay full input price each call.
  const u = response.usage as unknown as {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  } | undefined;
  const providerName = (response as unknown as { provider?: string }).provider;
  const choice = response.choices[0] as unknown as {
    finish_reason?: string;
    native_finish_reason?: string;
  } | undefined;

  return {
    text: response.choices[0]?.message?.content || "",
    usage: {
      inputTokens: u?.prompt_tokens ?? 0,
      outputTokens: u?.completion_tokens ?? 0,
      cacheReadTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheCreateTokens: u?.prompt_tokens_details?.cache_write_tokens ?? 0,
      durationMs: Date.now() - start,
      providerName,
      billedCostUsd: u?.cost,
      reasoningTokens: u?.completion_tokens_details?.reasoning_tokens,
      finishReason: choice?.finish_reason,
      nativeFinishReason: choice?.native_finish_reason,
    },
  };
}

function analysisJsonSchema(singlePost: boolean): Record<string, unknown> {
  const resultProperties = {
    summary: { type: "string" },
    category: { type: "string", enum: CATEGORIES },
    target_audience: { type: "string" },
    tier: { type: "string", enum: TIERS },
    vibe_tags: {
      type: "array",
      items: { type: "string", enum: VIBE_TAGS },
      minItems: 1,
      maxItems: 3,
    },
    highlight: { type: "string" },
    strengths: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 3,
    },
    weaknesses: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 2,
    },
    similar_to: {
      type: "array",
      items: { type: "string" },
      maxItems: 3,
    },
  };
  const required = [
    "summary",
    "category",
    "target_audience",
    "tier",
    "vibe_tags",
    "highlight",
    "strengths",
    "weaknesses",
    "similar_to",
  ];

  if (singlePost) {
    return {
      type: "object",
      properties: resultProperties,
      required,
      additionalProperties: false,
    };
  }

  return {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            post_id: { type: "integer" },
            ...resultProperties,
          },
          required: ["post_id", ...required],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  };
}

/** Convert tier to numeric pick_score for DB sorting */
export function tierToPickScore(tier: Tier): number {
  return TIER_SCORES[tier] ?? 50;
}

export function parseTier(value: unknown): Tier {
  const s = String(value || "").toLowerCase().trim();
  if (TIERS.includes(s as Tier)) return s as Tier;
  return "mid";
}

export function parseVibeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const validTags = new Set<string>(VIBE_TAGS as unknown as string[]);
  return value
    .map(String)
    .filter((t) => validTags.has(t))
    .slice(0, 3);
}

/**
 * Extract the first complete JSON object from a string by matching braces.
 * Handles the case where the model appends text/commentary after the JSON.
 */
function extractJsonObject(raw: string): string {
  let stripped = raw.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
  stripped = repairLeadingJson(stripped);
  const results = extractJsonObjectsFromString(stripped, 1);
  if (results.length === 0) throw new Error("No JSON object found in response");
  return results[0];
}

/**
 * Repair a JSON response that's missing its leading `{` and possibly the first key.
 * Observed in Qwen 3.6 series before response_format was added — kept as a
 * defensive fallback for any provider that strips opening braces.
 *
 * Cases handled:
 *   1. `"key": "value", ...}`           → prepend `{`
 *   2. `": "value", "next_key": ...}`   → prepend `{"summary` (assume first key was `summary`)
 *   3. Anything starting with `{`        → unchanged
 */
function repairLeadingJson(s: string): string {
  if (!s) return s;
  if (s[0] === "{") return s;

  // Case 1: starts with a quoted key like `"summary": ...`
  if (/^\s*"[\w_]+"\s*:/.test(s)) {
    // If there's no `{` at all, or `{` only appears later than the first quote, prepend
    if (!s.includes("{") || s.indexOf("{") > s.indexOf('"')) {
      return "{" + s;
    }
  }

  // Case 2: starts mid-value like `": "value..."` — the first key was eaten too.
  // Our prompt's first field is `summary`, so reconstruct it.
  if (/^\s*"\s*:\s*/.test(s) || /^\s*:\s*"/.test(s)) {
    return `{"summary` + s;
  }

  // Case 3: starts with bare value like `"some text", "category": ...` — same fix
  if (/^\s*"[^"]*",\s*"[\w_]+"\s*:/.test(s)) {
    return `{"summary": ` + s;
  }

  return s;
}

/**
 * Extract all complete top-level JSON objects from a string using brace-depth matching.
 * Tolerates garbage between objects (missing commas, commentary, etc.).
 */
function extractJsonObjectsFromString(text: string, limit = Infinity): string[] {
  const objects: string[] = [];
  let i = 0;

  while (i < text.length && objects.length < limit) {
    // Find next opening brace
    const start = text.indexOf("{", i);
    if (start === -1) break;

    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;

    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (escape) { escape = false; continue; }
      if (ch === "\\" && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }

    if (end === -1) break; // Unmatched braces — stop
    objects.push(text.slice(start, end + 1));
    i = end + 1;
  }

  return objects;
}

function parseResult(raw: string): AnalysisResult {
  const jsonStr = extractJsonObject(raw);
  const parsed = JSON.parse(jsonStr);

  const tier = parseTier(parsed.tier);
  const vibe_tags = parseVibeTags(parsed.vibe_tags);
  const highlight = String(parsed.highlight || parsed.pick_reason || "");

  return {
    summary: String(parsed.summary || ""),
    category: CATEGORIES.includes(parsed.category) ? parsed.category : "Other",
    target_audience: String(parsed.target_audience || ""),
    tier,
    vibe_tags,
    highlight,
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.map(String) : [],
    similar_to: Array.isArray(parsed.similar_to) ? parsed.similar_to.map(String).slice(0, 3) : [],
    pick_reason: highlight,
  };
}

// ─── Batch Analysis ────────────────────────────────────────────────────────

export type BatchPost = {
  id: number;
  title: string;
  url: string | null;
  pageContent: string;
  storyText: string | null;
  readmeContent?: string;
  screenshotBase64?: string;
};

/** Estimate input tokens for a post, matching truncation in analyzeBatch() */
export function estimatePostTokens(post: BatchPost): number {
  const CHARS_PER_TOKEN = 4;
  const SCREENSHOT_TOKENS = 1600; // ~typical webp thumbnail
  const OVERHEAD = 100; // metadata, instructions per post

  let tokens = OVERHEAD;
  if (post.screenshotBase64) tokens += SCREENSHOT_TOKENS;
  tokens += Math.min(post.pageContent.length, 3000) / CHARS_PER_TOKEN;
  if (post.storyText) tokens += Math.min(post.storyText.length, 1000) / CHARS_PER_TOKEN;
  if (post.readmeContent) tokens += Math.min(post.readmeContent.length, 3000) / CHARS_PER_TOKEN;
  return Math.ceil(tokens);
}

/** Greedily pack posts into batches within a token budget */
export function buildBatches(posts: BatchPost[], maxBatchTokens = 10000, maxBatchSize = 5): BatchPost[][] {
  const batches: BatchPost[][] = [];
  let current: BatchPost[] = [];
  let currentTokens = 0;

  for (const post of posts) {
    const tokens = estimatePostTokens(post);
    if (current.length > 0 && (currentTokens + tokens > maxBatchTokens || current.length >= maxBatchSize)) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(post);
    currentTokens += tokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Analyze a batch of posts in a single API call.
 * Includes benchmark calibration context and enables within-batch ranking.
 */
export async function analyzeBatch(
  posts: BatchPost[],
  options: {
    excludeBenchmarkIds?: number[];
    modelOverride?: string;
    providerOverride?: string;
    routerProviderOverride?: string;
    allowRouterFallbacks?: boolean;
    /** Optional eval-only/model-specific guidance appended to the base rubric. */
    promptAppendix?: string;
    /** Only route to OpenRouter endpoints supporting every requested parameter. */
    routerRequireParameters?: boolean;
    /** Control OpenRouter reasoning; useful for compact classification calls. */
    routerReasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
    /** Enforce the full analysis object with JSON Schema instead of JSON mode. */
    structuredOutput?: boolean;
    /** Optional OpenRouter sampling temperature. */
    routerTemperature?: number;
  } = {}
): Promise<{ results: Map<number, AnalysisResult>; model: string; usage: UsageStats }> {
  if (posts.length === 0) throw new Error("analyzeBatch: empty batch");

  const provider = options.providerOverride || process.env.ANALYSIS_PROVIDER || "openai";
  const model = options.modelOverride || process.env.ANALYSIS_MODEL || "gpt-5-mini";
  const promptAppendix =
    options.promptAppendix ?? getJudgePromptAppendix(process.env.ANALYSIS_PROMPT_VARIANT);
  const routerAllowFallbacks =
    options.allowRouterFallbacks ?? optionalBooleanEnv("ANALYSIS_ROUTER_ALLOW_FALLBACKS");
  const routerRequireParameters =
    options.routerRequireParameters ?? optionalBooleanEnv("ANALYSIS_ROUTER_REQUIRE_PARAMETERS");
  const routerReasoningEffort =
    options.routerReasoningEffort ?? optionalReasoningEffortEnv();
  const routerTemperature =
    options.routerTemperature ?? optionalNumberEnv("ANALYSIS_TEMPERATURE");
  if (routerTemperature !== undefined && (routerTemperature < 0 || routerTemperature > 2)) {
    throw new Error("ANALYSIS_TEMPERATURE must be between 0 and 2");
  }
  const structuredOutput =
    options.structuredOutput ?? optionalBooleanEnv("ANALYSIS_STRUCTURED_OUTPUT") ?? false;
  const systemPrompt = buildSystemPrompt(options.excludeBenchmarkIds, promptAppendix);

  // Build content array with per-post data
  // (Benchmark calibration is in the system prompt, cached by Anthropic)
  const anthropicContent: Anthropic.Messages.ContentBlockParam[] = [];
  const openaiContent: OpenAI.ChatCompletionContentPart[] = [];

  // 1. Batch instructions
  const batchInstructions = posts.length === 1
    ? `Rate this project against the calibration references. Return a JSON object with the fields specified in the system prompt.`
    : `Rate these ${posts.length} projects against the calibration references AND relative to each other within this batch. For each post, return the fields specified in the system prompt.\n\nReturn a JSON object: { "results": [{ "post_id": <id>, ...fields }, ...] }\nOrder results by post_id.`;
  anthropicContent.push({ type: "text", text: batchInstructions });
  openaiContent.push({ type: "text", text: batchInstructions });

  // 3. Per-post data (text + optional screenshot)
  let imageCount = 0;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];

    // Screenshot image (if available)
    if (post.screenshotBase64) {
      anthropicContent.push({
        type: "image",
        source: { type: "base64", media_type: "image/webp", data: post.screenshotBase64 },
      });
      openaiContent.push({
        type: "image_url",
        image_url: { url: `data:image/webp;base64,${post.screenshotBase64}`, detail: "auto" },
      });
      imageCount++;
    }

    // Post text block
    const hasScreenshot = !!post.screenshotBase64;
    let postText = posts.length > 1
      ? `POST ${i + 1} (ID: ${post.id}):\n`
      : "";

    if (hasScreenshot) {
      postText += "A screenshot of the project's landing page is attached above. Use it to assess design and UI quality — but don't let visual polish inflate the tier. A clean landing page is table stakes, not a differentiator.\n\n";
    }

    postText += `Title: ${post.title}\n`;
    postText += `URL: ${post.url || "N/A (text-only post)"}\n`;
    if (post.storyText) {
      postText += `Author's description: ${post.storyText.replace(/<[^>]*>/g, " ").slice(0, 1000)}\n`;
    }
    postText += `\nPage content (truncated):\n${post.pageContent.slice(0, 3000)}`;
    if (post.readmeContent) {
      postText += `\n\nGitHub README (truncated):\n${post.readmeContent.slice(0, 3000)}`;
    }

    anthropicContent.push({ type: "text", text: postText });
    openaiContent.push({ type: "text", text: postText });
  }

  // Call the provider
  const postIds = posts.map(p => p.id);
  console.log(`[llm] analyzeBatch: ${posts.length} post(s) [${postIds.join(",")}], ${imageCount} screenshot(s), provider=${provider}, model=${model}`);

  let resp: ProviderResponse;
  if (provider === "anthropic") {
    const prefill = posts.length === 1 ? "{" : '{"results": [{"post_id":';
    resp = await callAnthropic(systemPrompt, anthropicContent, model, prefill);
  } else if (provider === "openrouter") {
    resp = await callOpenRouter(
      systemPrompt,
      openaiContent,
      model,
      options.routerProviderOverride,
      routerAllowFallbacks,
      routerRequireParameters,
      routerReasoningEffort,
      structuredOutput ? analysisJsonSchema(posts.length === 1) : undefined,
      routerTemperature,
    );
  } else {
    resp = await callOpenAI(systemPrompt, openaiContent, model);
  }

  // Log usage
  const { usage } = resp;
  const cacheInfo = usage.cacheReadTokens > 0
    ? ` cache_read=${usage.cacheReadTokens}`
    : usage.cacheCreateTokens > 0
      ? ` cache_write=${usage.cacheCreateTokens}`
      : "";
  const routeInfo = usage.providerName ? ` provider=${usage.providerName}` : "";
  const costInfo = usage.billedCostUsd !== undefined ? ` cost=$${usage.billedCostUsd.toFixed(6)}` : "";
  const reasoningInfo = usage.reasoningTokens ? ` reasoning=${usage.reasoningTokens}` : "";
  const finishInfo = usage.finishReason ? ` finish=${usage.finishReason}${usage.nativeFinishReason ? `/${usage.nativeFinishReason}` : ""}` : "";
  console.log(`[llm] API response: ${usage.inputTokens} in + ${usage.outputTokens} out tokens,${cacheInfo} ${usage.durationMs}ms${routeInfo}${costInfo}${reasoningInfo}${finishInfo}`);

  // Parse response
  const expectedIds = posts.map((p) => p.id);
  let results: Map<number, AnalysisResult>;
  try {
    results = parseBatchResult(resp.text, expectedIds, posts.length === 1);
  } catch (err) {
    // Log truncated raw response for debugging parse failures
    const preview = resp.text.slice(0, 500);
    console.error(`[llm] Parse failed for batch [${postIds.join(",")}]: ${(err as Error).message}`);
    console.error(`[llm] Raw response (first 500 chars): ${preview}`);
    throw err;
  }
  return { results, model, usage };
}

/** Parse a single result object into [postId, AnalysisResult] if it has a valid post_id. */
function parseResultObject(
  obj: Record<string, unknown>,
  expectedIds: number[]
): [number, AnalysisResult] | null {
  const postId = Number(obj.post_id);
  if (!expectedIds.includes(postId)) return null;

  const tier = parseTier(obj.tier);
  const vibe_tags = parseVibeTags(obj.vibe_tags);
  const highlight = String(obj.highlight || obj.pick_reason || "");

  return [postId, {
    summary: String(obj.summary || ""),
    category: CATEGORIES.includes(obj.category as string) ? (obj.category as string) : "Other",
    target_audience: String(obj.target_audience || ""),
    tier,
    vibe_tags,
    highlight,
    strengths: Array.isArray(obj.strengths) ? obj.strengths.map(String) : [],
    weaknesses: Array.isArray(obj.weaknesses) ? obj.weaknesses.map(String) : [],
    similar_to: Array.isArray(obj.similar_to) ? obj.similar_to.map(String).slice(0, 3) : [],
    pick_reason: highlight,
  }];
}

/**
 * Parse a batch response into a Map of post ID → AnalysisResult.
 * Handles both single-post (flat JSON) and multi-post ({ "results": [...] }) formats.
 * Falls back to extracting individual JSON objects if the outer JSON is malformed.
 */
function parseBatchResult(
  raw: string,
  expectedIds: number[],
  singlePost: boolean
): Map<number, AnalysisResult> {
  const results = new Map<number, AnalysisResult>();

  // Try clean parse first
  let jsonStr: string | null = null;
  let parsed: Record<string, unknown> | null = null;
  try {
    jsonStr = extractJsonObject(raw);
    parsed = JSON.parse(jsonStr);
  } catch {
    // JSON is structurally broken or truncated — fall through to repair path
  }

  if (singlePost && parsed && !parsed.results && jsonStr) {
    const result = parseResult(jsonStr!);
    results.set(expectedIds[0], result);
    return results;
  }

  if (parsed && Array.isArray(parsed.results)) {
    // Clean parse succeeded — extract results normally
    for (const item of parsed.results as unknown[]) {
      const r = parseResultObject(item as Record<string, unknown>, expectedIds);
      if (r) results.set(r[0], r[1]);
    }
  } else {
    // Repair path: the outer JSON is malformed (missing commas, truncated array),
    // but individual result objects inside are usually well-formed.
    const stripped = raw.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();

    // Try to find the "results": [ array and extract objects from INSIDE it.
    // Top-level extraction fails here because the inner objects are nested —
    // we need to skip past the wrapper to find them.
    let innerObjects: string[] = [];
    const resultsArrayMatch = stripped.match(/"results"\s*:\s*\[/);
    if (resultsArrayMatch && resultsArrayMatch.index !== undefined) {
      const arrayStart = resultsArrayMatch.index + resultsArrayMatch[0].length;
      innerObjects = extractJsonObjectsFromString(stripped.slice(arrayStart));
    }

    // Fallback: try top-level extraction (handles non-results-array formats)
    if (innerObjects.length === 0) {
      innerObjects = extractJsonObjectsFromString(stripped);
    }

    console.log(`[llm] JSON repair: extracted ${innerObjects.length} objects from malformed response`);

    for (const objStr of innerObjects) {
      try {
        const obj = JSON.parse(objStr);
        // Skip the outer wrapper if we accidentally grabbed it
        if (obj.results && !obj.post_id && !obj.tier) continue;
        const r = parseResultObject(obj, expectedIds);
        if (r) results.set(r[0], r[1]);
      } catch {
        // Individual object is also broken — skip it
      }
    }
  }

  const missing = expectedIds.filter((id) => !results.has(id));
  if (missing.length > 0 && results.size === 0) {
    throw new Error(`Batch response missing all post IDs: ${missing.join(", ")}`);
  }
  if (missing.length > 0) {
    console.warn(`[llm] Partial batch: recovered ${results.size}/${expectedIds.length}, missing: ${missing.join(", ")}`);
  }

  return results;
}

/**
 * Analyze a single post — backward-compatible wrapper around analyzeBatch().
 * All existing callers (worker, rescore) continue to work unchanged.
 */
export async function analyzePost(
  title: string,
  url: string | null,
  pageContent: string,
  storyText: string | null,
  readmeContent?: string,
  screenshotBase64?: string
): Promise<{ result: AnalysisResult; model: string; usage: UsageStats }> {
  const { results, model, usage } = await analyzeBatch([{
    id: 0, title, url, pageContent, storyText, readmeContent, screenshotBase64,
  }]);
  const result = results.get(0);
  if (!result) throw new Error("analyzePost: no result returned for post");
  return { result, model, usage };
}
