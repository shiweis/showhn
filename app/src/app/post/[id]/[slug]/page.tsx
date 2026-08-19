import { getPost, getRelatedPosts } from "@/lib/db/queries";
import { categoryToSlug } from "@/lib/categories";
import { triggerRefreshIfStale, triggerGitHubRefreshIfStale } from "@/lib/refresh";
import { sanitizeHtml } from "@/lib/sanitize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TIERS, TIER_LABELS, TIER_DOTS, type Tier, getVibeTagColor } from "@/lib/ai/llm";

function safeParseTier(value: string | null | undefined): Tier | null {
  if (!value) return null;
  return (TIERS as readonly string[]).includes(value) ? (value as Tier) : null;
}

function safeParseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ShareButton } from "@/components/share-button";
import { PostCard } from "@/components/post-card";
import { JsonLd } from "@/components/json-ld";

type Props = {
  params: Promise<{ id: string; slug: string }>;
};

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/^show hn:\s*/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const post = await getPost(parseInt(id, 10));
  if (!post) return { title: "Not Found" };

  const title = post.title.replace(/^Show HN:\s*/i, "");
  const description = post.analysis?.summary || `Show HN: ${title}`;
  const slug = slugify(post.title);
  const canonical = `https://hnshowcase.com/post/${post.id}/${slug}`;
  const ogImage = post.hasScreenshot
    ? `https://hnshowcase.com/screenshots/${post.id}.webp`
    : "https://hnshowcase.com/og-image.png";

  return {
    title: `${title} — HN Showcase`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${title} — HN Showcase`,
      description,
      url: canonical,
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} — HN Showcase`,
      description,
      images: [ogImage],
    },
  };
}

// Tier badge styling
const tierBadgeStyles: Record<string, string> = {
  gem: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/50 dark:text-violet-200 dark:border-violet-700",
  banger: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-700",
  solid: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-700",
  mid: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-600",
  pass: "bg-zinc-50 text-zinc-500 border-zinc-200 dark:bg-zinc-800/50 dark:text-zinc-400 dark:border-zinc-700",
};

export default async function PostPage({ params }: Props) {
  const { id } = await params;
  const post = await getPost(parseInt(id, 10));
  if (!post) notFound();
  triggerRefreshIfStale(post);
  triggerGitHubRefreshIfStale(post);

  const displayTitle = post.title.replace(/^Show HN:\s*/i, "");
  const hnUrl = `https://news.ycombinator.com/item?id=${post.id}`;
  const date = new Date(post.createdAt * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const vibeTags: string[] = safeParseJsonArray(post.analysis?.vibeTags);
  const strengths: string[] = safeParseJsonArray(post.analysis?.strengths);
  const weaknesses: string[] = safeParseJsonArray(post.analysis?.weaknesses);
  const similarTo: string[] = safeParseJsonArray(post.analysis?.similarTo);
  const tier = safeParseTier(post.analysis?.tier);

  // Structured data for SEO — SoftwareApplication schema
  const slug = slugify(post.title);
  const canonical = `https://hnshowcase.com/post/${post.id}/${slug}`;
  const isoDate = new Date(post.createdAt * 1000).toISOString();
  const screenshotUrl = post.hasScreenshot
    ? `https://hnshowcase.com/screenshots/${post.id}.webp`
    : undefined;
  const category = post.analysis?.category || "Other";

  // Map tier to a 1-5 rating for schema.org
  const tierRating: Record<string, number> = {
    gem: 5, banger: 4, solid: 3, mid: 2, pass: 1,
  };
  const ratingValue = tier ? tierRating[tier] || 3 : undefined;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: displayTitle,
    url: post.url || canonical,
    description: post.analysis?.summary || displayTitle,
    applicationCategory: category,
    datePublished: isoDate,
    author: {
      "@type": "Person",
      name: post.author,
    },
    ...(screenshotUrl && {
      image: screenshotUrl,
      screenshot: screenshotUrl,
    }),
    ...(post.githubLanguage && {
      programmingLanguage: post.githubLanguage,
    }),
    ...(post.analysis?.targetAudience && {
      audience: {
        "@type": "Audience",
        audienceType: post.analysis.targetAudience,
      },
    }),
    ...(ratingValue && {
      review: {
        "@type": "Review",
        author: {
          "@type": "Organization",
          name: "HN Showcase",
          url: "https://hnshowcase.com",
        },
        reviewRating: {
          "@type": "Rating",
          ratingValue,
          bestRating: 5,
          worstRating: 1,
        },
        reviewBody: post.analysis?.pickReason || post.analysis?.summary || "",
      },
    }),
    ...(post.url && {
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    }),
  };

  return (
    <div className="max-w-4xl mx-auto">
      <JsonLd data={structuredData} />
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
        Back to browse
      </Link>

      {/* Screenshot / GitHub hero — hidden for text-only posts */}
      {!!(post.githubStars != null || post.hasScreenshot) && (
        <div className="rounded-lg border border-border overflow-hidden bg-muted mb-6">
          {post.githubStars != null ? (
            <div className="flex flex-col justify-center px-8 py-8 bg-gradient-to-br from-muted to-muted/80">
              <div className="flex items-center gap-2 text-muted-foreground/70 mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                <span className="text-sm font-medium">GitHub Repository</span>
              </div>
              {post.githubDescription && (
                <p className="text-sm text-foreground/80 mb-4 leading-relaxed">{post.githubDescription}</p>
              )}
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  {post.githubStars.toLocaleString()} stars
                </span>
                {post.githubLanguage && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-primary/60" />
                    {post.githubLanguage}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="relative aspect-[16/10]">
              <Image
                src={`/screenshots/${post.id}.webp`}
                alt={displayTitle}
                fill
                className="object-cover object-top"
                priority
              />
            </div>
          )}
        </div>
      )}

      {/* Title + meta */}
      <h1 className="text-2xl sm:text-3xl font-display font-bold mb-2">{displayTitle}</h1>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground mb-4">
        <span>by <span className="font-medium text-foreground">{post.author}</span></span>
        <span>&middot;</span>
        <span>{date}</span>
        <span>&middot;</span>
        <span>{post.points} {post.points === 1 ? 'point' : 'points'}</span>
        <span>&middot;</span>
        <span>{post.comments} {post.comments === 1 ? 'comment' : 'comments'}</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {post.url && (
          <Button asChild>
            <a href={post.url} target="_blank" rel="noopener noreferrer">
              Visit Project
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-1"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
            </a>
          </Button>
        )}
        <Button variant="outline" asChild>
          <a href={hnUrl} target="_blank" rel="noopener noreferrer">
            View on HN
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-1"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
          </a>
        </Button>
        <ShareButton url={`https://hnshowcase.com/post/${post.id}/${slugify(post.title)}`} title={displayTitle} />
      </div>

      {/* AI Analysis */}
      {post.analysis && (
        <div className="border border-border rounded-lg overflow-hidden mb-6">
          <div className="bg-accent/50 px-6 py-3 border-b border-border">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4Z"/></svg>
              AI Analysis
            </h2>
          </div>
          <div className="p-6 space-y-4">
            {/* Tier + Vibe Tags */}
            {(tier || vibeTags.length > 0) && (
              <div className="flex flex-wrap items-center gap-2">
                {tier && (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${tierBadgeStyles[tier] || tierBadgeStyles.mid}`}>
                    <span className="tracking-tighter">{TIER_DOTS[tier]}</span>
                    {TIER_LABELS[tier] || tier}
                  </span>
                )}
                {vibeTags.map((tag) => (
                  <span
                    key={tag}
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getVibeTagColor(tag)}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Editorial take — structured if strengths/weaknesses available, fallback otherwise */}
            {post.analysis.pickReason && post.analysis.pickReason !== "Nothing stands out" && (
              <div className="space-y-3">
                {strengths.length > 0 || weaknesses.length > 0 ? (
                  <>
                    <p className="text-sm italic text-muted-foreground leading-relaxed">{post.analysis.pickReason}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {strengths.length > 0 && (
                        <div className="border-l-2 border-emerald-400 dark:border-emerald-500 pl-3">
                          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Strengths</span>
                          <ul className="mt-1.5 space-y-1">
                            {strengths.map((s) => <li key={s} className="text-sm leading-relaxed flex gap-2"><span className="text-emerald-400 dark:text-emerald-500 mt-1.5 shrink-0">&#8226;</span><span>{s}</span></li>)}
                          </ul>
                        </div>
                      )}
                      {weaknesses.length > 0 && (
                        <div className="border-l-2 border-amber-400 dark:border-amber-500 pl-3">
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">Weaknesses</span>
                          <ul className="mt-1.5 space-y-1">
                            {weaknesses.map((w) => <li key={w} className="text-sm leading-relaxed flex gap-2"><span className="text-amber-400 dark:text-amber-500 mt-1.5 shrink-0">&#8226;</span><span>{w}</span></li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">The Take</span>
                    <p className="mt-1 leading-relaxed">{post.analysis.pickReason}</p>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {post.analysis.category && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Category</span>
                  <div className="mt-1.5">
                    <Link href={`/category/${categoryToSlug(post.analysis.category)}`}>
                      <Badge className="hover:bg-primary/90 transition-colors">{post.analysis.category}</Badge>
                    </Link>
                  </div>
                </div>
              )}

              {post.analysis.targetAudience && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Target Audience</span>
                  <p className="mt-1">{post.analysis.targetAudience}</p>
                </div>
              )}

            </div>

            {similarTo.length > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Similar To</span>
                <p className="mt-1 text-sm">{similarTo.join(" · ")}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Story text if present */}
      {post.storyText && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-muted/50 px-6 py-3 border-b border-border">
            <h2 className="font-semibold text-sm">Post Description</h2>
          </div>
          <div className="p-6">
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.storyText) }}
            />
          </div>
        </div>
      )}

      {/* Related Projects */}
      <RelatedProjects postId={post.id} title={post.title} summary={post.analysis?.summary || ""} />
    </div>
  );
}

async function RelatedProjects({ postId, title, summary }: { postId: number; title: string; summary: string }) {
  const related = await getRelatedPosts(postId, title, summary, 6);
  if (related.length === 0) return null;

  return (
    <div className="mt-10">
      <h2 className="text-lg font-display font-semibold mb-4">Similar Projects</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {related.map((p) => (
          <PostCard key={p.id} post={p} analysis={p.analysis} compact />
        ))}
      </div>
    </div>
  );
}
