"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { PostCard } from "@/components/post-card";
import { loadMorePosts } from "@/app/actions";
import type { PostCardWithAnalysis } from "@/lib/db/card-types";

const PAGE_SIZE = 48;

type LoadedGrid = { posts: PostCardWithAnalysis[]; hasMore: boolean };

/**
 * What each grid had loaded, by filter, for as long as the tab's page lives.
 * Opening a post and pressing Back mounts the grid again; with this it comes
 * back holding the same cards, so the browser can restore the scroll position.
 * Without it the grid restarted at 48 cards and the visitor lost their place.
 * A full page load starts with nothing here, so the first render always
 * matches what the server sent.
 */
const loadedByFilter = new Map<string, LoadedGrid>();
const REMEMBERED_FILTERS = 8;

function remember(key: string, grid: LoadedGrid) {
  loadedByFilter.delete(key);
  loadedByFilter.set(key, grid);
  if (loadedByFilter.size > REMEMBERED_FILTERS) {
    loadedByFilter.delete(loadedByFilter.keys().next().value!);
  }
}

/** The remembered grid, but only while the server's first page still starts it. */
function startingGrid(key: string, initialPosts: PostCardWithAnalysis[]): LoadedGrid {
  const loaded = loadedByFilter.get(key);
  if (loaded && loaded.posts.length > 0 && loaded.posts[0].id === initialPosts[0]?.id) return loaded;
  return { posts: initialPosts, hasMore: initialPosts.length >= PAGE_SIZE };
}

export function PostGrid({
  initialPosts,
  time,
  sort,
  categories,
}: {
  initialPosts: PostCardWithAnalysis[];
  time: string;
  sort: string;
  categories: string[];
}) {
  const key = `${time}|${sort}|${categories.join(",")}`;
  const [grid, setGrid] = useState(() => ({ source: initialPosts, ...startingGrid(key, initialPosts) }));
  const [isPending, startTransition] = useTransition();
  const [loadError, setLoadError] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // The server sent a different first page (the filters changed): start over from it.
  if (grid.source !== initialPosts) {
    setGrid({ source: initialPosts, ...startingGrid(key, initialPosts) });
    setLoadError("");
  }

  const { posts, hasMore } = grid;

  useEffect(() => {
    remember(key, { posts, hasMore });
  }, [key, posts, hasMore]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoadError("");

    startTransition(async () => {
      try {
        const { posts: newPosts } = await loadMorePosts({
          time,
          sort,
          categories,
          offset: posts.length,
          limit: PAGE_SIZE,
        });
        setGrid((previous) => {
          // An answer for filters the visitor has since left.
          if (previous.source !== initialPosts) return previous;
          const existing = new Set(previous.posts.map((post) => post.id));
          return {
            source: previous.source,
            posts: [...previous.posts, ...newPosts.filter((post) => !existing.has(post.id))],
            hasMore: newPosts.length >= PAGE_SIZE,
          };
        });
      } catch {
        setLoadError("Could not load more projects. Please try again.");
      } finally {
        loadingRef.current = false;
      }
    });
  }, [hasMore, posts.length, time, sort, categories, startTransition, initialPosts]);

  // Intersection observer for auto-loading
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "400px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} analysis={post.analysis} />
        ))}
      </div>

      {(hasMore || loadError) && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          {isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <svg className="animate-spin size-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading more...
            </div>
          ) : loadError ? (
            <div className="text-center" role="status" aria-live="polite">
              <p className="mb-2 text-sm text-destructive">{loadError}</p>
              <button
                onClick={loadMore}
                className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Try again
              </button>
            </div>
          ) : (
            <button
              onClick={loadMore}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Load more
            </button>
          )}
        </div>
      )}
    </>
  );
}
