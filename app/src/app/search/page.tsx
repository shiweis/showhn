import { PostCard } from "@/components/post-card";
import { searchPosts, getCategories } from "@/lib/db/queries";
import Link from "next/link";
import { SearchInput } from "./search-input";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search",
  description: "Search Show HN projects by keyword, technology, or category.",
};

const EXAMPLE_SEARCHES = [
  "chess engine",
  "open source",
  "Rust CLI",
  "machine learning",
  "self-hosted",
  "browser extension",
  "real-time",
  "database",
];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const query = (params.q || "").trim().slice(0, 200);
  const [results, categories] = await Promise.all([
    query ? searchPosts(query) : Promise.resolve([]),
    !query ? getCategories() : Promise.resolve([]),
  ]);

  return (
    <>
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
          Back to browse
        </Link>

        <h1 className="text-xl font-display font-bold mb-3">
          {query ? (
            <>
              Results for &ldquo;{query}&rdquo;
              <span className="text-muted-foreground font-normal text-base ml-2">
                ({results.length} found)
              </span>
            </>
          ) : (
            "Search"
          )}
        </h1>

        <SearchInput defaultValue={query} />
      </div>

      {query && results.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 opacity-40"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <p className="text-lg font-medium">No results found</p>
          <p className="text-sm mt-1">Try different keywords or broader terms.</p>
        </div>
      ) : results.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {results.map((post) => (
            <PostCard key={post.id} post={post} analysis={post.analysis} />
          ))}
        </div>
      ) : !query ? (
        <div className="max-w-lg mx-auto pt-8 pb-20">
          <div className="mb-8">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Try searching for</h2>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_SEARCHES.map((term) => (
                <Link
                  key={term}
                  href={`/search?q=${encodeURIComponent(term)}`}
                  className="px-3 py-1.5 text-sm rounded-full border border-border bg-card hover:bg-accent hover:border-primary/30 transition-colors"
                >
                  {term}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Browse by category</h2>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <Link
                  key={cat}
                  href={`/?cat=${encodeURIComponent(cat)}`}
                  className="px-3 py-1.5 text-sm rounded-full border border-border bg-card hover:bg-accent hover:border-primary/30 transition-colors"
                >
                  {cat}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
