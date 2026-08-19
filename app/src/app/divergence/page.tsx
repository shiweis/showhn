import { PostCard } from "@/components/post-card";
import { getDivergenceData } from "@/lib/db/trends-queries";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI vs HN — HN Showcase",
  description: "Where our AI and Hacker News disagree: hidden gems the crowd missed, and overhyped posts our AI didn't buy.",
  alternates: { canonical: "https://hnshowcase.com/divergence" },
  openGraph: {
    title: "AI vs HN — HN Showcase",
    description: "Where our AI and Hacker News disagree: hidden gems the crowd missed, and overhyped posts our AI didn't buy.",
    url: "https://hnshowcase.com/divergence",
    images: [{ url: "https://hnshowcase.com/og-image.png", width: 1200, height: 630 }],
  },
};

export default async function DivergencePage() {
  const { gems, overhyped, stats } = getDivergenceData();

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

        <h1 className="text-2xl sm:text-3xl font-display font-bold">AI vs HN</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          Our AI sometimes disagrees with Hacker News. Here&apos;s where the gap was widest &mdash; hidden gems the crowd missed, and hyped posts our AI didn&apos;t buy.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        <div className="border border-border rounded-lg p-4 bg-card text-center">
          <div className="text-2xl font-bold">{stats.totalAnalyzed.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Posts Analyzed</div>
        </div>
        <div className="border border-border rounded-lg p-4 bg-card text-center">
          <div className="text-2xl font-bold text-violet-600 dark:text-violet-400">{stats.hiddenGems}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Hidden Gems</div>
        </div>
        <div className="border border-border rounded-lg p-4 bg-card text-center">
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.overhyped}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Overhyped</div>
        </div>
        <div className="border border-border rounded-lg p-4 bg-card text-center">
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.agreementPct}%</div>
          <div className="text-xs text-muted-foreground mt-0.5">Agreement</div>
        </div>
      </div>

      {/* Hidden Gems */}
      {gems.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-500"><path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg>
            Hidden Gems
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Rated gem by our AI &mdash; but HN gave them 10 points or fewer.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {gems.map((post) => (
              <PostCard key={post.id} post={post} analysis={post.analysis} />
            ))}
          </div>
        </section>
      )}

      {/* Overhyped */}
      {overhyped.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><path d="m18 15-6-6-6 6"/></svg>
            Crowd Favorites, AI Skeptic
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            HN gave these 25+ points &mdash; our AI rated them mid or pass.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {overhyped.map((post) => (
              <PostCard key={post.id} post={post} analysis={post.analysis} />
            ))}
          </div>
        </section>
      )}

      {gems.length === 0 && overhyped.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg font-medium">No divergence data yet</p>
          <p className="text-sm mt-1">Check back once more posts have been analyzed.</p>
        </div>
      )}
    </>
  );
}
