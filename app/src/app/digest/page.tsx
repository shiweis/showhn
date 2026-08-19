import { PostCard } from "@/components/post-card";
import { Badge } from "@/components/ui/badge";
import { SubscribeForm } from "@/components/subscribe-form";
import { getDigest } from "@/lib/db/queries";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Daily Digest — HN Showcase",
  description: "Today's best Show HN projects, curated by AI.",
  alternates: { canonical: "https://hnshowcase.com/digest" },
  openGraph: {
    title: "Daily Digest — HN Showcase",
    description: "Today's best Show HN projects, curated by AI.",
    url: "https://hnshowcase.com/digest",
    images: [{ url: "https://hnshowcase.com/og-image.png", width: 1200, height: 630 }],
  },
};

export default async function DigestPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const digest = await getDigest(params.date);

  const displayDate = new Date(digest.date + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Navigate to prev/next day
  const dateObj = new Date(digest.date + "T00:00:00Z");
  const prevDate = new Date(dateObj.getTime() - 86400000).toISOString().split("T")[0];
  const nextDate = new Date(dateObj.getTime() + 86400000).toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];
  const isToday = digest.date === today;

  const sortedCategories = Object.entries(digest.stats.categories)
    .sort(([, a], [, b]) => b - a);

  return (
    <>
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
          Back to browse
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold">Daily Digest</h1>
            <p className="text-muted-foreground mt-1">{displayDate}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Link
              href={`/digest?date=${prevDate}`}
              className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Previous day"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </Link>
            {!isToday && (
              <Link
                href={`/digest?date=${nextDate}`}
                className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Next day"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      {digest.stats.total > 0 && (
        <div className="border border-border rounded-lg p-4 mb-8 bg-card">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <span className="text-2xl font-bold">{digest.stats.total}</span>
              <span className="text-sm text-muted-foreground ml-1.5">projects</span>
            </div>
            <div className="h-8 w-px bg-border hidden sm:block" />
            <div className="flex flex-wrap gap-1.5">
              {sortedCategories.map(([cat, count]) => (
                <Badge key={cat} variant="secondary" className="text-xs">
                  {cat} ({count})
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}

      {digest.stats.total === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 opacity-40"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M8 12h8"/></svg>
          <p className="text-lg font-medium">No projects this day</p>
          <p className="text-sm mt-1">Try navigating to a different date.</p>
        </div>
      ) : (
        <>
          {/* AI Picks */}
          {digest.aiPicks.length > 0 && (
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                Top Picks
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {digest.aiPicks.map((post) => (
                  <PostCard key={post.id} post={post} analysis={post.analysis} />
                ))}
              </div>
            </section>
          )}

          {/* Top Posts */}
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
              Top by Points
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {digest.topPosts.map((post) => (
                <PostCard key={post.id} post={post} analysis={post.analysis} />
              ))}
            </div>
          </section>
        </>
      )}

      {/* Subscribe */}
      <div className="mt-12">
        <SubscribeForm />
      </div>
    </>
  );
}
