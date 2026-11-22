import { CATEGORY_MAP, categoryToSlug } from "./categories";

export const VALID_TIMES = ["today", "week", "month", "all"] as const;
export const VALID_SORTS = ["newest", "points", "comments", "interesting"] as const;

export type TimeRange = (typeof VALID_TIMES)[number];
export type SortOption = (typeof VALID_SORTS)[number];

const CATEGORY_NAMES = new Set(Object.values(CATEGORY_MAP));

export function normalizeTime(value: unknown, fallback: TimeRange = "week"): TimeRange {
  return typeof value === "string" && VALID_TIMES.includes(value as TimeRange)
    ? value as TimeRange
    : fallback;
}

export function normalizeSort(value: unknown, fallback: SortOption = "newest"): SortOption {
  return typeof value === "string" && VALID_SORTS.includes(value as SortOption)
    ? value as SortOption
    : fallback;
}

export function normalizeCategories(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [...new Set(values.filter((item): item is string =>
    typeof item === "string" && CATEGORY_NAMES.has(item),
  ))].slice(0, CATEGORY_NAMES.size);
}

export function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(parsed), maximum));
}

/** What each kind of listing page shows when its address names no time range or sort. */
export const HOME_FILTER_DEFAULTS = { time: "week", sort: "newest" } as const;
export const CATEGORY_FILTER_DEFAULTS = { time: "all", sort: "interesting" } as const;

/**
 * The address for a set of filters. On a category page one chosen category
 * leads to that category's page; anything else leads to the home page with
 * the categories as `cat` parameters. Values equal to the target page's own
 * defaults are left out.
 */
export function filterHref(
  state: { time: string; sort: string; categories: string[] },
  onCategoryPage: boolean,
): string {
  const toCategoryPage = onCategoryPage && state.categories.length === 1;
  const defaults = toCategoryPage ? CATEGORY_FILTER_DEFAULTS : HOME_FILTER_DEFAULTS;

  const params = new URLSearchParams();
  if (state.time !== defaults.time) params.set("t", state.time);
  if (state.sort !== defaults.sort) params.set("sort", state.sort);
  if (!toCategoryPage) {
    for (const category of state.categories) params.append("cat", category);
  }

  const path = toCategoryPage ? `/category/${categoryToSlug(state.categories[0])}` : "/";
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
