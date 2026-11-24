import { sqlite } from "./index";
import type { PostCardWithAnalysis } from "./card-types";
import { mapRawPostCard, RAW_POST_CARD_COLUMNS, type RawPostCardRow } from "./queries";
import { createShortCache } from "../short-cache";

interface DivergenceStats {
  totalAnalyzed: number;
  hiddenGems: number;
  overhyped: number;
  agreementPct: number;
}

interface DivergenceData {
  gems: PostCardWithAnalysis[];
  overhyped: PostCardWithAnalysis[];
  stats: DivergenceStats;
}

/**
 * A gem counts as hidden only once HN has had this long to vote on it.
 * Without it every gem starts out "hidden", because a new post has few points.
 */
export const HIDDEN_GEM_MIN_AGE_SECONDS = 48 * 60 * 60;

/** How long the page's lists and numbers are reused. They take a pass over every post. */
const DIVERGENCE_TTL_MS = 5 * 60_000;

const GEMS_SQL = `
  SELECT ${RAW_POST_CARD_COLUMNS}
  FROM posts p
  JOIN ai_analysis a ON p.id = a.post_id
  WHERE p.status = 'active'
    AND a.tier = 'gem'
    AND p.points <= 10
    AND p.created_at <= @hiddenBefore
  ORDER BY p.created_at DESC
  LIMIT 12
`;

const OVERHYPED_SQL = `
  SELECT ${RAW_POST_CARD_COLUMNS}
  FROM posts p
  JOIN ai_analysis a ON p.id = a.post_id
  WHERE p.status = 'active'
    AND a.tier IN ('mid', 'pass')
    AND p.points >= 25
  ORDER BY p.points DESC, a.pick_score ASC
  LIMIT 15
`;

const STATS_SQL = `
  SELECT
    COUNT(*) as total_analyzed,
    SUM(CASE WHEN a.tier IN ('gem', 'banger', 'mid', 'pass') THEN 1 ELSE 0 END) as total_opinionated,
    SUM(CASE WHEN a.tier = 'gem' AND p.points <= 10 AND p.created_at <= @hiddenBefore THEN 1 ELSE 0 END) as hidden_gems,
    SUM(CASE WHEN a.tier IN ('mid', 'pass') AND p.points >= 25 THEN 1 ELSE 0 END) as overhyped,
    SUM(CASE WHEN a.tier IN ('gem', 'banger') AND p.points >= 10 THEN 1 ELSE 0 END) as both_good,
    SUM(CASE WHEN a.tier IN ('mid', 'pass') AND p.points < 10 THEN 1 ELSE 0 END) as both_meh
  FROM posts p
  JOIN ai_analysis a ON p.id = a.post_id
  WHERE p.status = 'active'
    AND a.tier IS NOT NULL
`;

type StatsRow = {
  total_analyzed: number | null;
  total_opinionated: number | null;
  hidden_gems: number | null;
  overhyped: number | null;
  both_good: number | null;
  both_meh: number | null;
};

const cache = createShortCache({ ttlMs: DIVERGENCE_TTL_MS });

/** What the AI vs HN page shows, reused for a few minutes. */
export function getDivergenceData(): DivergenceData {
  return cache.get("divergence", () => readDivergenceData(Math.floor(Date.now() / 1000)));
}

/** The same, worked out now. `now` is in unix seconds. */
export function readDivergenceData(now: number): DivergenceData {
  const hiddenBefore = now - HIDDEN_GEM_MIN_AGE_SECONDS;
  const gems = (sqlite.prepare(GEMS_SQL).all({ hiddenBefore }) as RawPostCardRow[]).map(mapRawPostCard);
  const overhyped = (sqlite.prepare(OVERHYPED_SQL).all() as RawPostCardRow[]).map(mapRawPostCard);
  const statsRow = sqlite.prepare(STATS_SQL).get({ hiddenBefore }) as StatsRow | undefined;

  // Solid is the judge's "no strong view", so it says nothing about agreement.
  const totalOpinionated = statsRow?.total_opinionated ?? 0;
  const bothGood = statsRow?.both_good ?? 0;
  const bothMeh = statsRow?.both_meh ?? 0;
  const agreementPct = totalOpinionated > 0
    ? Math.round(((bothGood + bothMeh) / totalOpinionated) * 100)
    : 0;

  return {
    gems,
    overhyped,
    stats: {
      totalAnalyzed: statsRow?.total_analyzed ?? 0,
      hiddenGems: statsRow?.hidden_gems ?? 0,
      overhyped: statsRow?.overhyped ?? 0,
      agreementPct,
    },
  };
}
