"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { PostCard } from "@/components/post-card";
import { loadMorePosts } from "@/app/actions";
import type { PostCardWithAnalysis } from "@/lib/db/card-types";

const PAGE_SIZE = 48;

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
  const [posts, setPosts] = useState(initialPosts);
  const [hasMore, setHasMore] = useState(initialPosts.length >= PAGE_SIZE);
  const [isPending, startTransition] = useTransition();
  const [loadError, setLoadError] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Reset when filters change (initialPosts changes from server)
  useEffect(() => {
    setPosts(initialPosts);
    setHasMore(initialPosts.length >= PAGE_SIZE);
    setLoadError("");
    loadingRef.current = false;
  }, [initialPosts]);

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
        setPosts((previous) => {
          const existing = new Set(previous.map((post) => post.id));
          return [...previous, ...newPosts.filter((post) => !existing.has(post.id))];
        });
        if (newPosts.length < PAGE_SIZE) setHasMore(false);
      } catch {
        setLoadError("Could not load more projects. Please try again.");
      } finally {
        loadingRef.current = false;
      }
    });
  }, [hasMore, posts.length, time, sort, categories, startTransition]);

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
