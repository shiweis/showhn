"use server";

import { getPostsCached } from "@/lib/db/queries";
import type { PostCardWithAnalysis } from "@/lib/db/card-types";
import {
  normalizeCategories,
  normalizeInteger,
  normalizeSort,
  normalizeTime,
} from "@/lib/post-filters";

const MAX_LIMIT = 100;

export async function loadMorePosts({
  time = "week",
  sort = "newest",
  categories = [],
  offset = 0,
  limit = 48,
}: {
  time?: string;
  sort?: string;
  categories?: string[];
  offset?: number;
  limit?: number;
}): Promise<{ posts: PostCardWithAnalysis[] }> {
  const safeTime = normalizeTime(time);
  const safeSort = normalizeSort(sort);
  const safeLimit = normalizeInteger(limit, 48, 1, MAX_LIMIT);
  const safeOffset = normalizeInteger(offset, 0, 0, 1_000_000);
  const safeCategories = normalizeCategories(categories);

  const { posts } = await getPostsCached({
    time: safeTime,
    sort: safeSort,
    categories: safeCategories,
    offset: safeOffset,
    limit: safeLimit,
    includeTotal: false,
  });
  return { posts };
}
