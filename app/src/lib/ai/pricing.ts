/** Token-cost estimates for the judging models, used by the eval scripts. */

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
};

type ModelPrice = {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /**
   * Anthropic reports cached prompt tokens outside `input_tokens` and bills
   * them at these multiples of the input rate. Left unset for OpenRouter
   * models, whose prompt-token count already includes cached tokens.
   */
  cacheWriteMultiplier?: number;
  cacheReadMultiplier?: number;
};

const PRICING: Record<string, ModelPrice> = {
  // Rate card for prompts of 100K tokens or fewer; judging prompts are ~10K.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1 },
  // Used as the reference labeller. Cache reads are $0.20/M, i.e. 0.025x input.
  "claude-fable-5-2": { input: 8, output: 40, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.025 },
  "minimax/minimax-m3": { input: 0.23, output: 0.96 },
  "qwen/qwen3.5-397b-a17b": { input: 0.39, output: 2.34 },
};

/** Estimated USD cost of one call; 0 when the model has no price entry. */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const price = PRICING[model];
  if (!price) return 0;
  const billedInputTokens =
    usage.inputTokens +
    usage.cacheCreateTokens * (price.cacheWriteMultiplier ?? 0) +
    usage.cacheReadTokens * (price.cacheReadMultiplier ?? 0);
  return (billedInputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}
