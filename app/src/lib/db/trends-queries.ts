import { sqlite } from "./index";
import type { PostCardWithAnalysis } from "./card-types";
import { mapRawPostCard, RAW_POST_CARD_COLUMNS, type RawPostCardRow } from "./queries";

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

const GEMS_SQL = `
  SELECT ${RAW_POST_CARD_COLUMNS}
  FROM posts p
  JOIN ai_analysis a ON p.id = a.post_id
  WHERE p.status = 'active'
    AND a.tier = 'gem'
    AND p.points <= 10
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
    SUM(CASE WHEN a.tier IN ('gem', 'banger', 'mid', 'pass') THEN 1 ELSE 0 END) as total_opinionated,
    SUM(CASE WHEN a.tier = 'gem' AND p.points <= 10 THEN 1 ELSE 0 END) as hidden_gems,
    SUM(CASE WHEN a.tier IN ('mid', 'pass') AND p.points >= 25 THEN 1 ELSE 0 END) as overhyped,
    SUM(CASE WHEN a.tier IN ('gem', 'banger') AND p.points >= 10 THEN 1 ELSE 0 END) as both_good,
    SUM(CASE WHEN a.tier IN ('mid', 'pass') AND p.points < 10 THEN 1 ELSE 0 END) as both_meh
  FROM posts p
  JOIN ai_analysis a ON p.id = a.post_id
  WHERE p.status = 'active'
    AND a.tier IS NOT NULL
`;

export function getDivergenceData(): DivergenceData {
  const gems = (sqlite.prepare(GEMS_SQL).all() as RawPostCardRow[]).map(mapRawPostCard);
  const overhyped = (sqlite.prepare(OVERHYPED_SQL).all() as RawPostCardRow[]).map(mapRawPostCard);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statsRow = sqlite.prepare(STATS_SQL).get() as any;

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
      totalAnalyzed: totalOpinionated,
      hiddenGems: statsRow?.hidden_gems ?? 0,
      overhyped: statsRow?.overhyped ?? 0,
      agreementPct,
    },
  };
}
