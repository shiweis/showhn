/**
 * Human-audited judging ground truth that is never included in the production
 * calibration prompt. These entries are reserved for clean holdout evaluation.
 *
 * Audit method (Aug 2026): review the stored Show HN description, fetched page
 * and README text, and screenshot where available; then apply the current tier
 * rubric without consulting production/Qwen ratings. Historical labels were
 * corrected when the evidence did not support them.
 */

import type { BenchmarkEntry } from "./benchmark";

export type AuditedJudgeEntry = BenchmarkEntry & {
  /** How this label differs from the historical 30-example eval, if at all. */
  auditNote: string;
};

export const AUDITED_HOLDOUT_ENTRIES: AuditedJudgeEntry[] = [
  {
    postId: 46994974,
    title: "YOR – open-source bimanual mobile robot for <$10k",
    tier: "gem",
    reason:
      "A validated bimanual mobile robot with a detailed open BOM around one-fifth the cost of comparable proprietary platforms. The constraint, hardware execution, paper, and reproducibility make it broadly shareable.",
    auditNote: "Historical gem label confirmed.",
  },
  {
    postId: 47792525,
    title: "MacMind – A transformer neural network in HyperCard on a 1989 Macintosh",
    tier: "gem",
    reason:
      "A complete trainable transformer, including backpropagation and attention, implemented in HyperTalk on a 1989 Macintosh. It is verifiable constraint craft with educational value and an immediate 'how?' reaction.",
    auditNote: "Historical gem label confirmed.",
  },
  {
    postId: 47088108,
    title: "Open-source MCP servers making every country's law searchable by AI",
    tier: "banger",
    reason:
      "Fifteen deployed, Apache-licensed national-law servers backed by official sources are substantial and useful. It is not a gem because legal retrieval/RAG and machine-readable law already exist; the breadth and execution are the differentiators.",
    auditNote: "Corrected from gem to banger; the original zero-to-one claim was overstated.",
  },
  {
    postId: 47808268,
    title: "Smol machines – subsecond coldstart, portable virtual machines",
    tier: "banger",
    reason:
      "A mature, installable microVM tool with sub-200ms boots, hardware isolation, portable single-file workloads, egress controls, and persistent environments. The combination is differentiated enough to merit an 'oh, cool' reaction.",
    auditNote: "Corrected from solid to banger; the implementation and differentiation clear the higher bar.",
  },
  {
    postId: 47072863,
    title: "An encrypted, local, cross-platform journaling app",
    tier: "solid",
    reason:
      "A shipped Tauri journal with AES-GCM, X25519 key files, O(1) wrapped-key management, imports, backups, and cross-platform releases. The security design is interesting, but encrypted local journals are an established category.",
    auditNote: "Historical solid label confirmed.",
  },
  {
    postId: 47640728,
    title: "A game where you build a GPU",
    tier: "banger",
    reason:
      "The substantial interactive transistor-to-processor curriculum teaches systems by doing and is visually well executed. Later GPU acts remain unfinished, but the production rubric explicitly treats a real in-browser GPU builder as banger-level educational craft.",
    auditNote:
      "Historical banger label retained after a second audit; demoting it contradicted an explicit production-rubric archetype.",
  },
  {
    postId: 47655367,
    title: "Gemma Gem – AI model embedded in a browser – no API keys, no cloud",
    tier: "banger",
    reason:
      "Running Gemma locally through WebGPU with screenshot and DOM tools in a real extension inverts the usual cloud-agent architecture. Multi-step reliability is limited, but the production rubric explicitly names this architecture as a banger.",
    auditNote:
      "Historical banger label retained after a second audit; demoting it contradicted an explicit production-rubric archetype.",
  },
  {
    postId: 47702791,
    title: "41 years sea surface temperature anomalies",
    tier: "solid",
    reason:
      "A polished, explorable 41-year NOAA anomaly visualization with a globe, timeline, and curated events. It has a clear interesting angle, but remains a focused data visualization for a narrower audience.",
    auditNote: "Historical solid label confirmed.",
  },
  {
    postId: 47025220,
    title: "DSCI – Dead Simple CI",
    tier: "mid",
    reason:
      "A working Forgejo-oriented CI framework with language SDKs, but it competes in a mature CI market and replacing YAML with Bash or Python is not a strong differentiator.",
    auditNote: "Historical mid label confirmed.",
  },
  {
    postId: 47036063,
    title: "Maths, CS and AI Compendium",
    tier: "mid",
    reason:
      "A genuine intuition-first collection, but only the first six of eighteen planned chapters are available and the product is primarily Markdown notes in a crowded educational category.",
    auditNote: "Historical mid label confirmed.",
  },
  {
    postId: 47100874,
    title: "3mins.news – AI daily news briefing in 17 languages, designed to end",
    tier: "mid",
    reason:
      "A functioning multilingual AI news digest with source aggregation, but AI-generated daily summaries are a crowded product category and the page shows no distinctive technical approach.",
    auditNote: "Historical mid label confirmed.",
  },
  {
    postId: 47357376,
    title: "DevNode.studio, 100% local dev tools to make back end work faster",
    tier: "pass",
    reason:
      "A collection of commodity JSON, regex, UUID, timestamp, JWT, and conversion utilities already available in browser DevTools, CyberChef, and many static sites, with no chaining or distinctive depth.",
    auditNote: "Historical pass label confirmed.",
  },
  {
    postId: 47094649,
    title: "Google started to (quietly) insert (self) ads into Gemini output",
    tier: "pass",
    reason:
      "A personal observation linking to Google My Activity, not a shipped project or demo. It is an opinion/discussion post submitted to the wrong Show HN venue.",
    auditNote: "Historical pass label confirmed.",
  },
];

/**
 * A second, recent-history holdout sampled from Jul–Aug 2026 without reading any
 * existing ai_analysis rows. Candidates were reviewed from raw post/page/README
 * evidence and selected to provide exactly three examples per tier.
 */
export const AUDITED_RECENT_ENTRIES: AuditedJudgeEntry[] = [
  {
    postId: 49008211,
    title: "Bento – An entire PowerPoint in one HTML file (edit+view+data+collab)",
    tier: "gem",
    reason:
      "The document contains its own editor, presenter, assets, charts, animations, persistence, and encrypted live collaboration in a roughly 560KB offline HTML file. The constraint and complete execution make it immediately shareable.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 49021270,
    title: "Physically accurate black hole you can put in your room",
    tier: "gem",
    reason:
      "An astrophysicist built real-time relativistic ray tracing that runs on ordinary screens, WebXR, VR, and live camera feeds, including lensing, Doppler boosting, and light-travel delay. It combines rare expertise with playful, broadly shareable execution.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 48926939,
    title: "Firefox in WebAssembly",
    tier: "gem",
    reason:
      "The full Gecko engine, Firefox UI, and SpiderMonkey run inside a browser canvas through WebAssembly, with encrypted networking and an experimental WASM-to-JS JIT. This is unambiguous boundary-pushing constraint craft.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 48870746,
    title: "Make images render brighter than white by abusing Rec.2100 PQ profiles",
    tier: "solid",
    reason:
      "A working browser tool and rigorous explanation turn PQ ICC-profile research into a self-serve HDR image trick. It is concrete and clever, but narrow, novelty-oriented, and credits the core discovery to prior research rather than changing what is feasible.",
    auditNote:
      "Corrected from the first human banger label to solid after applying the rubric's narrow-novelty boundary; existing AI judgment was not used as authority.",
  },
  {
    postId: 49170165,
    title: "Simple algorithm and color space to generate diverse skin tones",
    tier: "banger",
    reason:
      "A thoughtful custom color space, procedural sampler, interactive picker, equations, demos, and candid limitations address an underserved design problem with a specific non-obvious method. It is both technically interesting and practically reusable.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 49270040,
    title: "Woxi – Open-source Mathematica / Wolfram Language reimplementation",
    tier: "banger",
    reason:
      "A Rust Wolfram Language interpreter with a native studio, CLI, Jupyter kernel, Python/npm packages, WASM playground, millisecond startup, and roughly 27,000 tests is a deep, credible alternative to a difficult proprietary target.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 49007948,
    title: "LapDeck – Turn your phone into a remote deck for your Windows laptop",
    tier: "solid",
    reason:
      "A local PWA with app launching, touchpad gestures, keyboard, screen streaming, media, power controls, Tailscale support, and a documented security model is substantial. Remote-control products are established, so the execution is more notable than the idea.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 49062678,
    title: "Amplified Futures – no-wave VCV Rack 2 modules",
    tier: "solid",
    reason:
      "Fifteen released and tested VCV Rack modules form a coherent instrument around massed oscillators, feedback, microtonality, and live collapse controls. It is genuinely crafted and interesting, but highly specialized.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 49068151,
    title: "Mapify Your Repository",
    tier: "solid",
    reason:
      "A polished live survey turns directories into districts, important files into landmarks, and dependencies into roads. The cartographic interaction is a distinctive angle, but codebase maps and dependency visualizers are an established category.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 48939688,
    title: "CreditKit, a Stripe usage-credits engine I kept rebuilding",
    tier: "mid",
    reason:
      "A paid Next.js/Supabase/Stripe starter covering atomic credit spending, idempotent webhooks, and refunds. Useful plumbing, but it is still boilerplate sold in a crowded starter-kit market rather than a differentiated product.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 48862079,
    title: "NoMac – let your AI agent ship iOS apps without a Mac",
    tier: "mid",
    reason:
      "A hosted cloud-Mac build, TestFlight, and App Store submission pipeline with agent-oriented commands. It appears functional, but remote iOS CI is already served by Xcode Cloud, Bitrise, Codemagic, and others, while cloud simulation remains a promise.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 48826962,
    title: "ChatGPT, Claude and Codex-style chat inputs in one React component",
    tier: "mid",
    reason:
      "A polished set of copy-paste React compositions that imitate seven familiar AI chat inputs. The implementation is useful, but cloning existing interface patterns and packaging them as component boilerplate does not create a novel product angle.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 49143176,
    title: "CaLLMar – play a text-based adventure game in an LLM chat",
    tier: "pass",
    reason:
      "The repository is one commit containing a README prompt that asks an LLM to improvise a conventional fantasy RPG. There is no game engine, state implementation, demo, or other shipped product beyond instructions.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 48994041,
    title: "Free visitor sign-in template for construction sites (OSHA compliant)",
    tier: "pass",
    reason:
      "A static printable visitor log with standard date, name, company, ID, vehicle, and signature columns. It is an advertisement for a digital product and is reproducible in a spreadsheet in minutes.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
  {
    postId: 49207773,
    title: "Free online calculators – no signup, no fees",
    tier: "pass",
    reason:
      "A directory claiming hundreds of generic finance, health, conversion, and formula calculators. The feature count substitutes for depth, and dominant free alternatives already cover every listed calculation.",
    auditNote: "New human label; existing AI judgment was not consulted.",
  },
];

export const AUDITED_COMBINED_HOLDOUT_ENTRIES: AuditedJudgeEntry[] = [
  ...AUDITED_HOLDOUT_ENTRIES,
  ...AUDITED_RECENT_ENTRIES,
];

/** Cases reviewed but deliberately excluded from exact-match accuracy. */
export const EXCLUDED_AUDIT_ENTRIES = [
  {
    postId: 47040375,
    title: "Free Alternative to Wispr Flow, Superwhisper, and Monologue",
    historicalTier: "banger",
    auditNote:
      "Borderline solid/banger: it ships and matches a valuable paid feature, but remains a Groq-backed clone in a crowded category. Exact-match scoring would overstate subjective certainty.",
  },
  {
    postId: 47206680,
    title: "RTS – A Git-native execution provenance protocol for AI decisions",
    historicalTier: "pass",
    auditNote:
      "Stale evidence: the live repository now has a runnable Python starter, tests, scripts, and services, contradicting the original 'no working code' rationale. Its evolution also makes a frozen historical label unfair.",
  },
] as const;
