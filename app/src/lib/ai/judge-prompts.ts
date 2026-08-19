/** Model-specific judging guidance selected explicitly through environment configuration. */

export const MINIMAX_M3_JUDGE_PROMPT_V3 = `## FINAL CLASSIFICATION GATES — THESE OVERRIDE A SAFER MIDDLE-TIER INSTINCT

Use the evidence rubric above, then apply these gates in order. Stop at the first terminal gate.

1. PASS (terminal). Return pass when the core artifact is any of these, even if it works and is
   polished: a printable or single-form tracker reproducible on paper/in a spreadsheet; a prompt,
   manifesto, or claims page rather than a product; or a generic converter/calculator/dev-tool
   collection already supplied by browsers, CyberChef, or many free sites without a new advanced
   capability. Privacy, no signup, free access, and visual design cannot lift those examples to mid.
2. GEM (terminal). Return gem for verified impossible-seeming constraint craft with a measured
   result, even when ordinary non-core features are absent. Also return gem when a genuinely rare
   maker/cross-project collaboration is itself a surprising story and produced a major measured
   outcome. Do not demote these to banger merely to be conservative.
3. BANGER. Require novelty, strong executed evidence, and a meaningful change in what is feasible.
   Moving a substantial previously CUDA-bound pipeline onto ordinary consumer hardware can meet
   this bar; convenient packaging of a known inspector or workflow does not.
4. SOLID versus MID. A finished interactive explanation or tool grounded in the maker's real domain
   expertise is solid when that expertise creates one concrete interesting angle. Small audience,
   vanilla JavaScript, or lack of a framework are not reasons for mid. Use mid only when removing
   polish and feature count leaves no specific interesting angle.

Before emitting JSON, perform two literal checks: (a) if you described a paper/spreadsheet or
dominant-free-tool substitute and no advanced differentiator, the answer must be pass; (b) if you
described a completed domain-expert interactive simulation, the answer cannot be mid. Make the tier
agree with your own evidence. Keep the highlight at 15 words or fewer. Tier percentages are not
per-batch quotas.`;

export const JUDGE_PROMPT_VARIANTS = {
  production: "",
  "minimax-m3-v3": MINIMAX_M3_JUDGE_PROMPT_V3,
} as const;

export type JudgePromptVariant = keyof typeof JUDGE_PROMPT_VARIANTS;

export function getJudgePromptAppendix(
  variant: string | undefined,
): string | undefined {
  if (!variant || variant === "production") return undefined;
  if (!(variant in JUDGE_PROMPT_VARIANTS)) {
    throw new Error(
      `Unknown ANALYSIS_PROMPT_VARIANT "${variant}"; expected ${Object.keys(JUDGE_PROMPT_VARIANTS).join(", ")}`,
    );
  }
  return JUDGE_PROMPT_VARIANTS[variant as JudgePromptVariant] || undefined;
}
