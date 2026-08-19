import { CATEGORY_MAP } from "./categories";

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
