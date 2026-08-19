"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, useOptimistic, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { normalizeCategories, normalizeSort, normalizeTime } from "@/lib/post-filters";

const TIME_TABS = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
  { label: "All Time", value: "all" },
] as const;

const SORT_OPTIONS = [
  { label: "Newest", value: "newest" },
  { label: "Most Points", value: "points" },
  { label: "Most Discussed", value: "comments" },
  { label: "Best Vibes", value: "interesting" },
] as const;

type FilterState = {
  time: string;
  sort: string;
  categories: string[];
};

export function FilterBar({ categories, totalCount }: { categories: string[]; totalCount?: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentState: FilterState = {
    time: normalizeTime(searchParams.get("t")),
    sort: normalizeSort(searchParams.get("sort")),
    categories: normalizeCategories(searchParams.getAll("cat")),
  };

  const [optimisticState, setOptimisticState] = useOptimistic(currentState);

  const navigate = useCallback((newState: FilterState) => {
    const params = new URLSearchParams();
    if (newState.time !== "week") params.set("t", newState.time);
    if (newState.sort !== "newest") params.set("sort", newState.sort);
    for (const cat of newState.categories) params.append("cat", cat);
    const qs = params.toString();
    startTransition(() => {
      setOptimisticState(newState);
      router.push(qs ? `/?${qs}` : "/");
    });
  }, [router, startTransition, setOptimisticState]);

  function setTime(value: string) {
    navigate({ ...optimisticState, time: value });
  }

  function setSort(value: string) {
    navigate({ ...optimisticState, sort: value });
  }

  function toggleCategory(cat: string) {
    const current = optimisticState.categories;
    const updated = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat];
    navigate({ ...optimisticState, categories: updated });
  }

  function clearCategories() {
    navigate({ ...optimisticState, categories: [] });
  }

  return (
    <div className={cn("space-y-3 mb-6 transition-opacity duration-150", isPending && "opacity-60")}>
      {/* Time tabs + sort row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-0.5 bg-muted/60 rounded-lg p-0.5 overflow-x-auto">
          {TIME_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setTime(tab.value)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-all duration-150 cursor-pointer",
                optimisticState.time === tab.value
                  ? "bg-primary text-primary-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/60"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 bg-muted/40 rounded-lg p-0.5 overflow-x-auto">
          <span className="text-xs text-muted-foreground mx-1.5 hidden sm:inline">Sort:</span>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSort(opt.value)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-md whitespace-nowrap transition-all duration-150 cursor-pointer",
                optimisticState.sort === opt.value
                  ? "bg-background text-foreground font-medium shadow-sm dark:bg-secondary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {optimisticState.categories.length > 0 && (
            <button
              onClick={clearCategories}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 shrink-0 rounded-full hover:bg-muted transition-colors duration-150 cursor-pointer"
            >
              Clear
            </button>
          )}
          {categories.map((cat) => {
            const isActive = optimisticState.categories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className="shrink-0"
                aria-pressed={isActive}
                aria-label={`Filter by ${cat}`}
              >
                <Badge
                  variant={isActive ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer whitespace-nowrap select-none transition-all duration-150",
                    isActive
                      ? "shadow-sm"
                      : "hover:bg-accent hover:text-accent-foreground hover:border-primary/30"
                  )}
                >
                  {cat}
                </Badge>
              </button>
            );
          })}
        </div>
      )}

      {/* Result count */}
      {totalCount !== undefined && (
        <p className="text-xs text-muted-foreground">
          {totalCount} project{totalCount !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
