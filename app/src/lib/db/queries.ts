import { db } from "./index";
import { posts, aiAnalysis } from "./schema";
import { desc, eq, gte, ne, and, inArray, sql } from "drizzle-orm";
import type { Post, AiAnalysis } from "./schema";
import type { PostCardWithAnalysis } from "./card-types";
import type { SortOption, TimeRange } from "../post-filters";

const POST_CARD_SELECTION = {
  post: {
    id: posts.id,
    title: posts.title,
    url: posts.url,
    author: posts.author,
    points: posts.points,
    comments: posts.comments,
    createdAt: posts.createdAt,
    // Cards only display a short text-post preview. Avoid shipping the full
    // story/page/README corpus through the React server payload.
    storyText: sql<string | null>`substr(${posts.storyText}, 1, 500)`,
    hasScreenshot: posts.hasScreenshot,
    githubStars: posts.githubStars,
    githubLanguage: posts.githubLanguage,
    githubDescription: posts.githubDescription,
    status: posts.status,
  },
  analysis: {
    postId: aiAnalysis.postId,
    summary: aiAnalysis.summary,
    category: aiAnalysis.category,
    pickReason: aiAnalysis.pickReason,
    pickScore: aiAnalysis.pickScore,
    tier: aiAnalysis.tier,
    vibeTags: aiAnalysis.vibeTags,
  },
};

export const RAW_POST_CARD_COLUMNS = `
  p.id, p.title, p.url, p.author, p.points, p.comments, p.created_at,
  substr(p.story_text, 1, 500) AS story_text,
  p.has_screenshot, p.github_stars, p.github_language,
  p.github_description, p.status,
  a.post_id AS a_post_id, a.summary AS a_summary,
  a.category AS a_category, a.pick_reason AS a_pick_reason,
  a.pick_score AS a_pick_score, a.tier AS a_tier,
  a.vibe_tags AS a_vibe_tags
`;

export type RawPostCardRow = {
  id: number;
  title: string;
  url: string | null;
  author: string;
  points: number | null;
  comments: number | null;
  created_at: number;
  story_text: string | null;
  has_screenshot: number | null;
  github_stars: number | null;
  github_language: string | null;
  github_description: string | null;
  status: string | null;
  a_post_id: number | null;
  a_summary: string | null;
  a_category: string | null;
  a_pick_reason: string | null;
  a_pick_score: number | null;
  a_tier: string | null;
  a_vibe_tags: string | null;
};

export function mapRawPostCard(row: RawPostCardRow): PostCardWithAnalysis {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    author: row.author,
    points: row.points,
    comments: row.comments,
    createdAt: row.created_at,
    storyText: row.story_text,
    hasScreenshot: row.has_screenshot,
    githubStars: row.github_stars,
    githubLanguage: row.github_language,
    githubDescription: row.github_description,
    status: row.status,
    analysis: row.a_post_id === null ? null : {
      postId: row.a_post_id,
      summary: row.a_summary,
      category: row.a_category,
      pickReason: row.a_pick_reason,
      pickScore: row.a_pick_score,
      tier: row.a_tier,
      vibeTags: row.a_vibe_tags,
    },
  };
}

function getTimeFilter(range: TimeRange): number {
  const now = Math.floor(Date.now() / 1000);
  switch (range) {
    case "today":
      return now - 24 * 60 * 60;
    case "week":
      return now - 7 * 24 * 60 * 60;
    case "month":
      return now - 30 * 24 * 60 * 60;
    case "all":
      return 0;
    default:
      return now - 7 * 24 * 60 * 60;
  }
}

export async function getPosts({
  time = "week",
  sort = "newest",
  categories = [],
  limit = 48,
  offset = 0,
  includeTotal = true,
}: {
  time?: TimeRange;
  sort?: SortOption;
  categories?: string[];
  limit?: number;
  offset?: number;
  includeTotal?: boolean;
} = {}): Promise<{ posts: PostCardWithAnalysis[]; total: number }> {
  const timeFilter = getTimeFilter(time);

  const conditions: ReturnType<typeof gte>[] = [gte(posts.createdAt, timeFilter), ne(posts.status, "dead")];

  // Add category filter in SQL so it works correctly with LIMIT
  if (categories.length > 0) {
    conditions.push(inArray(aiAnalysis.category, categories));
  }

  // Build query with left join (inner join when filtering by category)
  const joinType = categories.length > 0 ? "inner" : "left";
  const baseQuery = joinType === "inner"
    ? db.select(POST_CARD_SELECTION).from(posts).innerJoin(aiAnalysis, eq(posts.id, aiAnalysis.postId))
    : db.select(POST_CARD_SELECTION).from(posts).leftJoin(aiAnalysis, eq(posts.id, aiAnalysis.postId));

  let query = baseQuery
    .where(and(...conditions))
    .limit(limit)
    .offset(offset);

  // Apply sort
  switch (sort) {
    case "newest":
      query = query.orderBy(desc(posts.createdAt)) as typeof query;
      break;
    case "points":
      query = query.orderBy(desc(posts.points)) as typeof query;
      break;
    case "comments":
      query = query.orderBy(desc(posts.comments)) as typeof query;
      break;
    case "interesting":
      query = query.orderBy(desc(aiAnalysis.pickScore), desc(posts.points)) as typeof query;
      break;
  }

  const results = query.all();

  // Get total count (without limit/offset) for the same filters
  let total = 0;
  if (includeTotal) {
    const countQuery = joinType === "inner"
      ? db.select({ count: sql<number>`count(*)` }).from(posts).innerJoin(aiAnalysis, eq(posts.id, aiAnalysis.postId)).where(and(...conditions))
      : db.select({ count: sql<number>`count(*)` }).from(posts).leftJoin(aiAnalysis, eq(posts.id, aiAnalysis.postId)).where(and(...conditions));
    total = countQuery.get()?.count ?? 0;
  }

  return {
    posts: results.map((r) => ({ ...r.post, analysis: r.analysis })),
    total,
  };
}

export async function getCategories(): Promise<string[]> {
  const results = db
    .selectDistinct({ category: aiAnalysis.category })
    .from(aiAnalysis)
    .where(sql`${aiAnalysis.category} IS NOT NULL`)
    .all();

  return results.map((r) => r.category!).sort();
}

export async function searchPosts(
  query: string,
  limit = 48
): Promise<PostCardWithAnalysis[]> {
  const normalizedQuery = query.trim().slice(0, 200);
  if (!normalizedQuery) return [];
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 100)) : 48;

  // FTS5 search — use raw SQL since Drizzle doesn't support virtual tables
  const { sqlite } = await import("./index");

  // Sanitize FTS5 query: wrap in double quotes to treat as a phrase and
  // prevent FTS5 syntax operators (*, OR, NOT, NEAR, column filters) from
  // causing parse errors. Escape any internal double quotes.
  const sanitized = '"' + normalizedQuery.replace(/"/g, '""') + '"';

  let rows: RawPostCardRow[];
  try {
    rows = sqlite
      .prepare(
        `SELECT ${RAW_POST_CARD_COLUMNS}
         FROM posts_fts fts
         JOIN posts p ON p.id = fts.rowid
         LEFT JOIN ai_analysis a ON p.id = a.post_id
         WHERE posts_fts MATCH ? AND p.status != 'dead'
         ORDER BY rank
         LIMIT ?`
      )
      .all(sanitized, safeLimit) as RawPostCardRow[];
  } catch {
    // FTS5 parse error — return empty results rather than 500
    return [];
  }

  return rows.map(mapRawPostCard);
}

export async function getDigest(date?: string): Promise<{
  date: string;
  topPosts: (Post & { analysis: AiAnalysis | null })[];
  aiPicks: (Post & { analysis: AiAnalysis | null })[];
  stats: { total: number; categories: Record<string, number> };
}> {
  // Parse date or default to yesterday (most recent complete day)
  const parsedDate = date ? new Date(date + "T00:00:00Z") : null;
  const targetDate = (parsedDate && !isNaN(parsedDate.getTime()))
    ? parsedDate
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dayStart = Math.floor(new Date(targetDate.toISOString().split("T")[0] + "T00:00:00Z").getTime() / 1000);
  const dayEnd = dayStart + 24 * 60 * 60;

  const dayPosts = db
    .select()
    .from(posts)
    .leftJoin(aiAnalysis, eq(posts.id, aiAnalysis.postId))
    .where(and(gte(posts.createdAt, dayStart), sql`${posts.createdAt} < ${dayEnd}`, ne(posts.status, "dead")))
    .all();

  const mapped = dayPosts.map((r) => ({
    ...r.posts,
    analysis: r.ai_analysis,
  }));

  // Top by points
  const topPosts = [...mapped].sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).slice(0, 10);

  // AI picks — gem and banger tier projects, falling back to high pickScore for legacy posts without tier
  const aiPicks = [...mapped]
    .filter((p) => {
      const tier = p.analysis?.tier;
      if (tier === "gem" || tier === "banger") return true;
      // Backward compat: include legacy posts without tier that had high scores
      if (!tier && (p.analysis?.pickScore ?? 0) >= 80) return true;
      return false;
    })
    .sort((a, b) => (b.analysis?.pickScore || 0) - (a.analysis?.pickScore || 0) || (b.points ?? 0) - (a.points ?? 0))
    .slice(0, 6);

  // Category breakdown
  const categories: Record<string, number> = {};
  for (const p of mapped) {
    const cat = p.analysis?.category;
    if (cat) categories[cat] = (categories[cat] || 0) + 1;
  }

  return {
    date: targetDate.toISOString().split("T")[0],
    topPosts,
    aiPicks,
    stats: { total: mapped.length, categories },
  };
}

// Stopwords for FTS queries — derived from corpus analysis of 10k+ Show HN posts.
// Includes terms appearing in 15+ of 16 categories (too generic to find similar projects)
// plus standard English stopwords. Tech-specific terms (python, rust, git, etc.) are
// deliberately kept — they carry real topical signal.
const STOPWORDS = new Set([
  // English stopwords
  "a","an","the","and","or","of","for","in","on","to","is","it","that","with","as",
  "by","from","this","at","be","are","was","has","its","into","not","can","you","your",
  "all","will","each","per","via","now","also","but","than","any","more","most","very",
  "just","only","been","being","have","had","having","do","does","did","doing","would",
  "should","could","may","might","shall","show","hn","one","two","first",
  "about","like","over","between","through","after","before","during","without",
  "within","across","along","behind","around","then","every","instead","their","them",
  "who","what","when","where","how","want","own","lets","turns","style","line",
  // Generic verbs (appear across all categories)
  "using","based","built","use","uses","used","make","makes","made","build","building",
  "run","runs","running","create","creating","find","get","gets","help","helps",
  "need","needs","provides","providing","requiring","allows","enable","enables",
  "designed","shows","showing","displays","generates","generated","generate",
  "combining","aimed","track","tracking","tracker","testing","written",
  // Generic tech/product terms (corpus: appear in 15+ of 16 categories)
  "tool","tools","app","apps","application","system","systems","platform","web",
  "new","open","source","project","real","time","data","file","files","code",
  "support","features","works","including","available","content","text",
  "page","pages","interface","user","users","site","post","word",
  "access","activity","analysis","backend","daily","detection","developers",
  "digital","driven","engine","export","feedback","grid","image","integration",
  "level","lightweight","live","local","maps","multi","native","network","news",
  "offline","optional","people","personal","powered","research","rest","search",
  "side","teams","type","video","visual","visualization","zero",
  // Generic format/delivery terms
  "chrome","extension","extensions","browser","cli","gui","desktop","mobile",
  "api","sdk","library","framework","plugin","widget","server","client",
  "terminal","hosted","chat",
  // Generic adjectives
  "high","low","fast","small","large","full","free","better","best","great",
  "simple","single","modern","custom","standard","different","specific","common",
  "alternative","implementation","performance",
  "automatic","automatically","non","required","proof","concept","general",
  "management","software","service","services","online","generation",
  "backed","computer","multiple",
]);

/**
 * Extract top search terms from title + summary for FTS5 OR queries.
 * Title words are weighted higher since they carry more topical signal.
 */
function extractSearchTerms(title: string, summary: string, maxTerms = 8): string {
  const clean = (s: string) => s.toLowerCase().replace(/^show hn:\s*/i, "").replace(/[^a-z0-9\s]/g, " ");
  const titleWords = clean(title).split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
  const summaryWords = clean(summary).split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));

  // Score each term: title words worth 2, summary words worth 1
  const scores = new Map<string, number>();
  for (const w of titleWords) scores.set(w, (scores.get(w) || 0) + 2);
  for (const w of summaryWords) scores.set(w, (scores.get(w) || 0) + 1);

  const topTerms = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([term]) => term);

  return topTerms.join(" OR ");
}

/**
 * Find related posts using FTS5 search on the current post's title + summary.
 * Returns up to `limit` related posts, excluding the current post and dead posts.
 */
export async function getRelatedPosts(
  postId: number,
  title: string,
  summary: string,
  limit = 6,
): Promise<PostCardWithAnalysis[]> {
  if (!title && !summary) return [];

  const { sqlite } = await import("./index");
  const query = extractSearchTerms(title, summary);
  if (!query) return [];

  let rows: RawPostCardRow[];
  try {
    rows = sqlite
      .prepare(
        `SELECT ${RAW_POST_CARD_COLUMNS}
         FROM posts_fts fts
         JOIN posts p ON p.id = fts.rowid
         LEFT JOIN ai_analysis a ON p.id = a.post_id
         WHERE posts_fts MATCH ? AND p.id != ? AND p.status = 'active'
         ORDER BY rank
         LIMIT ?`
      )
      .all(query, postId, limit) as RawPostCardRow[];
  } catch {
    return [];
  }

  return rows.map(mapRawPostCard);
}

/**
 * Get featured posts for the homepage hero — gems and bangers from the past week,
 * sorted by tier (gems first) then points. Falls back to month if not enough.
 */
export async function getFeaturedPosts(
  limit = 3,
): Promise<PostCardWithAnalysis[]> {
  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

  // Sort by points within top tiers — the hero should showcase the most
  // popular gems/bangers, not just any gem over a high-point banger.
  let results = db
    .select(POST_CARD_SELECTION)
    .from(posts)
    .innerJoin(aiAnalysis, eq(posts.id, aiAnalysis.postId))
    .where(and(
      gte(posts.createdAt, weekAgo),
      ne(posts.status, "dead"),
      inArray(aiAnalysis.tier, ["gem", "banger"]),
    ))
    .orderBy(desc(posts.points))
    .limit(limit)
    .all();

  // Fall back to month if not enough gems/bangers this week
  if (results.length < limit) {
    const monthAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    results = db
      .select(POST_CARD_SELECTION)
      .from(posts)
      .innerJoin(aiAnalysis, eq(posts.id, aiAnalysis.postId))
      .where(and(
        gte(posts.createdAt, monthAgo),
        ne(posts.status, "dead"),
        inArray(aiAnalysis.tier, ["gem", "banger"]),
      ))
      .orderBy(desc(posts.points))
      .limit(limit)
      .all();
  }

  return results.map((r) => ({
    ...r.post,
    analysis: r.analysis,
  }));
}

export async function getPost(id: number): Promise<(Post & { analysis: AiAnalysis | null }) | null> {
  const result = db
    .select()
    .from(posts)
    .leftJoin(aiAnalysis, eq(posts.id, aiAnalysis.postId))
    .where(eq(posts.id, id))
    .get();

  if (!result) return null;

  return {
    ...result.posts,
    analysis: result.ai_analysis,
  };
}
