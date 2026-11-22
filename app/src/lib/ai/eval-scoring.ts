/**
 * Scoring helpers for judging evals whose reference labels come from several
 * independent labelling runs per post.
 */

import { TIERS, type Tier } from "./llm";

export type ReferenceEntry = {
  postId: number;
  /** Tiers the labelling runs assigned, in tier order (gem first). */
  acceptable: Tier[];
  /** True when every labelling run chose the same tier. */
  firm: boolean;
};

/** Score a predicted tier against one or more acceptable reference tiers. */
export function scoreTier(
  actual: Tier,
  acceptable: readonly Tier[],
): { exact: boolean; tierDistance: number; nearest: Tier } {
  if (acceptable.length === 0) throw new Error("scoreTier needs at least one acceptable tier");
  const actualIndex = TIERS.indexOf(actual);
  let nearest = acceptable[0];
  let tierDistance = Math.abs(actualIndex - TIERS.indexOf(nearest));
  for (const tier of acceptable.slice(1)) {
    const distance = Math.abs(actualIndex - TIERS.indexOf(tier));
    if (distance < tierDistance) {
      nearest = tier;
      tierDistance = distance;
    }
  }
  return { exact: tierDistance === 0, tierDistance, nearest };
}

/**
 * Collapse labelling runs into one reference entry per post. Posts with fewer
 * than `minRuns` runs are left out, so a half-labelled post never counts as a
 * firm label.
 */
export function buildReferenceEntries(
  rows: { postId: number; run: number; tier: Tier }[],
  minRuns = 2,
): ReferenceEntry[] {
  const tiersByPost = new Map<number, Map<number, Tier>>();
  for (const row of rows) {
    const runs = tiersByPost.get(row.postId) ?? new Map<number, Tier>();
    runs.set(row.run, row.tier);
    tiersByPost.set(row.postId, runs);
  }

  const entries: ReferenceEntry[] = [];
  for (const [postId, runs] of tiersByPost) {
    if (runs.size < minRuns) continue;
    const acceptable = TIERS.filter((tier) => [...runs.values()].includes(tier));
    entries.push({ postId, acceptable, firm: acceptable.length === 1 });
  }
  return entries;
}
