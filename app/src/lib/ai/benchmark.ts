/**
 * Benchmark calibration set — 15 real Show HN posts (3 per tier) with
 * verified tier assignments and explanations. Injected into every analysis
 * call to anchor the model's judgment against known-good examples.
 *
 * History:
 * - Mar 2026: initial 15 calibrators (3 per tier).
 * - Apr 2026: expanded to 30 (6 per tier) to test prompt iteration. Eval showed
 *   the additional calibrators gave ~13pp accuracy lift (53→67%) but doubled
 *   system-prompt cost. Pruned back to 15 keeping the highest-signal ones from
 *   both sets — see selection notes in the entity (memory/entities/hnshowcase.md
 *   under "Calibration set design").
 *
 * Selection criteria for the active 15:
 * - 3 per tier, balancing URL types (~47% GitHub vs production's 41%)
 * - Multiple flavors per tier where justified (gem: constraint craft + collaboration)
 * - AI/agent calibrators present at every relevant tier
 * - Distinct failure modes at the floor (narrative-as-substitute, commodity clone, spec-as-product)
 * - Labels are reviewed against the rubric and project evidence independently of
 *   model agreement. A model repeatedly missing a defensible label is an eval signal,
 *   not a reason to redefine the label around that model's capabilities.
 * - Aug 2026 audit: restored the micro-habit tracker as a high-confidence pass and
 *   removed RTS, whose repository gained a runnable starter and no longer matched
 *   its "no working code" rationale.
 */

import type { Tier } from "./llm";

export type BenchmarkEntry = {
  postId: number;
  title: string;
  tier: Tier;
  reason: string;
};

export const BENCHMARK_ENTRIES: BenchmarkEntry[] = [
  // ── GEM ──
  {
    postId: 47014500,
    title: "Sameshi – a ~1200 Elo chess engine that fits within 2KB",
    tier: "gem",
    reason:
      "Pure demoscene-grade constraint craft. Any programmer shares this regardless of whether they play chess. The Elo measurement methodology is rigorous, not hand-waved.",
  },
  {
    postId: 47132102,
    title: "X86CSS – An x86 CPU emulator written in CSS",
    tier: "gem",
    reason:
      "x86 CPU emulator written entirely in CSS. No JavaScript. Actually runs C programs in the browser. The constraint isn't useful — that's the point. Anyone seeing this thinks \"wait, how?\" regardless of whether they care about CSS or x86. Pure \"why didn't anyone try this before\" energy.",
  },
  {
    postId: 47506713,
    title: "I took back Video.js after 16 years and we rewrote it to be 88% smaller",
    tier: "gem",
    reason:
      "Founder pulled Video.js back from PE acquisition, then teamed up with Plyr, Vidstack, and Media Chrome maintainers (75k combined stars) to share a single core. 88% bundle reduction is real and measurable. Different gem flavor — the rare-collaboration story IS the wow, not the technical execution alone.",
  },

  // ── BANGER ──
  {
    postId: 47022745,
    title: "Pangolin: Open-source identity-based VPN (Twingate/Zscaler alternative)",
    tier: "banger",
    reason:
      "Real architectural insight: resource-centric P2P vs device-centric (Tailscale) or central relay (Zscaler). Genuine differentiation, live cloud offering. Not gem because enterprise networking is well-funded.",
  },
  {
    postId: 47019133,
    title: "Off Grid – Run AI text, image gen, vision offline on your phone",
    tier: "banger",
    reason:
      "Genuinely comprehensive offline AI suite with hardware-accelerated inference on both platforms. Real benchmarks. On Google Play. Not gem because \"local LLM mobile apps\" is a known category. Banger because it inverts the usual cloud-AI deployment assumption.",
  },
  {
    postId: 47828896,
    title: "TRELLIS.2 image-to-3D running on Mac Silicon – no Nvidia GPU needed",
    tier: "banger",
    reason:
      "Real port of Microsoft's 4B-param image-to-3D model from CUDA to Apple Silicon. Replaces flex_gemm, flash_attn, and CUDA hashmap ops with pure-PyTorch alternatives across 9 files. 400K vertex meshes in 3.5min on M4 Pro. Banger because the engineering depth is verifiable in the port table, not because it's AI.",
  },

  // ── SOLID ──
  {
    postId: 47075124,
    title: "Micasa – track your house from the terminal",
    tier: "solid",
    reason:
      "VisiData-inspired modal TUI for home management — interesting domain for a terminal app. Privacy-first, thoughtful keyboard workflows. Not banger because audience is narrow (terminal users who own property).",
  },
  {
    postId: 47011567,
    title: "SQL-tap – Real-time SQL traffic viewer for PostgreSQL and MySQL",
    tier: "solid",
    reason:
      "Native wire protocol parsing means genuinely zero code changes. Real tool, ships today. Not banger because \"SQL query inspector\" is a solved category (Datadog, pgAdmin).",
  },
  {
    postId: 47338091,
    title: "Vanilla JavaScript refinery simulator built to explain job to my kids",
    tier: "solid",
    reason:
      "Chemical engineer wrote a 9k-line vanilla JS refinery simulator with Matter.js minigames to explain his job to his kids. Cozy, specific, genuinely well-built. Not banger because the audience is narrow (his family + curious onlookers). The \"why I built this\" story is what makes it solid not mid.",
  },

  // ── MID ──
  {
    postId: 47041288,
    title: "Deep Research for Flights",
    tier: "mid",
    reason:
      "Pleasant UX for a real friction point. But Google Flights flex dates, Kayak Explore already handle this. No evidence of better data or novel routing. Pattern: AI wrapper on a solved problem.",
  },
  {
    postId: 47086501,
    title: "TemplateFlow – Build AI workflows, not prompts",
    tier: "mid",
    reason:
      "Drag-and-drop visual builder for AI workflows with reusable templates. Real implementation. Competes directly with ComfyUI, n8n, Zapier, Langflow. Pattern: another no-code AI canvas in a crowded space. \"Build AI workflows, not prompts\" isn't a moat when five funded competitors do this.",
  },
  {
    postId: 47158467,
    title: "x402 Service Discovery – runtime endpoint finder for the agent economy",
    tier: "mid",
    reason:
      "Runtime endpoint finder for x402-payable AI services with quality signals on blockchain. Real API surface, real architecture. But the agent economy that pays per query isn't proven, and \"discovery layer for unproven economy\" = speculative infra. Pattern: real engineering aimed at a market that may not materialize.",
  },

  // ── PASS ──
  {
    postId: 46978700,
    title: "NOOR – A Sovereign AI developed on a smartphone under siege in Yemen",
    tier: "pass",
    reason:
      "Compelling narrative, zero technical substance. A crypto fundraiser with vague claims. No code, no demo, no verifiable output. Pattern: emotional story as a substitute for a project.",
  },
  {
    postId: 47031605,
    title: "Free Browser-Based Dev Tools (No Signup, Client-Side)",
    tier: "pass",
    reason:
      "Every tool exists on CyberChef, in browser DevTools, and on 50 other static sites. No chaining, no advanced features. Pattern: zero differentiation from free dominant alternatives.",
  },
  {
    postId: 47057956,
    title: "Free printable micro-habit tracker inspired by Atomic Habits",
    tier: "pass",
    reason:
      "A printable checkbox calendar with habit names and a month picker. It is functional, but a spreadsheet or paper grid reproduces it exactly. Pattern: single-gimmick utility with no technical or product depth.",
  },
];

/** Format benchmark entries as calibration context for the AI prompt.
 *  excludePostIds: leave-one-out support for eval — omit these posts from the calibration set. */
export function buildBenchmarkContext(excludePostIds?: number[]): string {
  const exclude = new Set(excludePostIds ?? []);
  const grouped: Record<string, BenchmarkEntry[]> = {};
  for (const entry of BENCHMARK_ENTRIES) {
    if (exclude.has(entry.postId)) continue;
    if (!grouped[entry.tier]) grouped[entry.tier] = [];
    grouped[entry.tier].push(entry);
  }

  const tierOrder: Tier[] = ["gem", "banger", "solid", "mid", "pass"];
  const sections: string[] = [];

  for (const tier of tierOrder) {
    const entries = grouped[tier] || [];
    const lines = entries.map((e) => `  * "${e.title}" — ${e.reason}`);
    sections.push(`${tier.toUpperCase()}:\n${lines.join("\n")}`);
  }

  return `## CALIBRATION REFERENCES — real projects with confirmed tiers. Use these to anchor your judgment.\n\n${sections.join("\n\n")}`;
}
