import { Suspense } from "react";
import { PostGrid } from "@/components/post-grid";
import { FilterBar } from "@/components/filter-bar";
import { HeroPicks } from "@/components/hero-picks";
import { getPosts, getCategories, getFeaturedPosts } from "@/lib/db/queries";
import { normalizeCategories, normalizeSort, normalizeTime } from "@/lib/post-filters";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const time = normalizeTime(params.t);
  const sort = normalizeSort(params.sort);
  const categories = normalizeCategories(params.cat);

  // Show hero on default view only (no filters, default time+sort)
  const isDefaultView = categories.length === 0 && time === "week" && sort === "newest";

  const [{ posts, total }, allCategories, featured] = await Promise.all([
    getPosts({ time, sort, categories }),
    getCategories(),
    isDefaultView ? getFeaturedPosts(3) : Promise.resolve([]),
  ]);

  return (
    <>
      <h1 className="sr-only">HN Showcase — AI-Powered Visual Gallery for Show HN Projects</h1>

      {featured.length > 0 && <HeroPicks posts={featured} />}

      <Suspense fallback={null}>
        <FilterBar categories={allCategories} totalCount={total} />
      </Suspense>

      {posts.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 opacity-40"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <p className="text-lg font-medium">No projects found</p>
          <p className="text-sm mt-1">Try expanding the time filter or removing category filters.</p>
        </div>
      ) : (
        <PostGrid
          initialPosts={posts}
          time={time}
          sort={sort}
          categories={categories}
        />
      )}
    </>
  );
}
