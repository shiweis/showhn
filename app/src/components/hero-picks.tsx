import Image from "next/image";
import Link from "next/link";
import type { PostCardWithAnalysis } from "@/lib/db/card-types";
import { TIER_LABELS, TIER_DOTS, type Tier, getVibeTagColor } from "@/lib/ai/llm";

function safeParseTier(value: string | null | undefined): Tier | null {
  if (!value) return null;
  const TIERS = ["gem", "banger", "solid", "mid", "pass"];
  return TIERS.includes(value) ? (value as Tier) : null;
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

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/^show hn:\s*/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

const tierBadgeStyles: Record<string, string> = {
  gem: "bg-violet-500/90 text-white",
  banger: "bg-amber-500/90 text-white",
};

export function HeroPicks({ posts }: { posts: PostCardWithAnalysis[] }) {
  if (posts.length === 0) return null;

  const [featured, ...rest] = posts;
  const featuredTitle = featured.title.replace(/^Show HN:\s*/i, "");
  const featuredSlug = slugify(featured.title);
  const featuredHref = `/post/${featured.id}/${featuredSlug}`;
  const featuredTier = safeParseTier(featured.analysis?.tier);
  const featuredTags = safeParseJsonArray(featured.analysis?.vibeTags);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display font-semibold flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          This Week&apos;s Picks
        </h2>
        <Link href="/digest" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          View digest →
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Featured (large) card */}
        <div className="lg:col-span-2 relative group">
          <Link href={featuredHref} prefetch={false}>
            <article className="rounded-lg border border-border bg-card overflow-hidden shadow-sm hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5 transition-all duration-200 h-full">
              <div className="flex flex-col sm:flex-row h-full">
                {/* Image */}
                <div className="relative sm:w-1/2 aspect-[16/10] sm:aspect-auto bg-muted overflow-hidden shrink-0">
                  {featured.hasScreenshot ? (
                    <Image
                      src={`/screenshots/${featured.id}_thumb.webp`}
                      alt={featuredTitle}
                      fill
                      className="object-cover object-top group-hover:scale-[1.03] transition-transform duration-300"
                      sizes="(max-width: 640px) 100vw, 40vw"
                      priority
                    />
                  ) : featured.githubStars != null ? (
                    <div className="absolute inset-0 flex flex-col justify-center px-6 py-4 bg-gradient-to-br from-muted to-muted/80">
                      <div className="flex items-center gap-1.5 text-muted-foreground/70 mb-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                        <span className="text-xs font-medium">GitHub</span>
                      </div>
                      {featured.githubDescription && (
                        <p className="text-sm text-foreground/80 line-clamp-2">{featured.githubDescription}</p>
                      )}
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40 bg-muted">
                      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-5 flex flex-col justify-center flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {featuredTier && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${tierBadgeStyles[featuredTier] || ""}`}>
                        <span className="tracking-tighter">{TIER_DOTS[featuredTier]}</span>
                        {TIER_LABELS[featuredTier]}
                      </span>
                    )}
                    {featured.analysis?.category && (
                      <span className="text-[10px] text-muted-foreground">{featured.analysis.category}</span>
                    )}
                  </div>
                  <h3 className="font-bold text-lg sm:text-xl leading-snug mb-2 group-hover:text-primary transition-colors line-clamp-2">
                    {featuredTitle}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2 italic">
                    {featured.analysis?.pickReason || featured.analysis?.summary || ""}
                  </p>
                  {featuredTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {featuredTags.slice(0, 3).map((tag) => (
                        <span key={tag} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${getVibeTagColor(tag)}`}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                    <span>by {featured.author}</span>
                    <span>▲ {featured.points}</span>
                    {(featured.comments ?? 0) > 0 && <span>💬 {featured.comments}</span>}
                  </div>
                </div>
              </div>
            </article>
          </Link>
        </div>

        {/* Side cards (smaller) */}
        <div className="flex flex-col gap-4">
          {rest.map((post) => (
            <SidePickCard key={post.id} post={post} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SidePickCard({ post }: { post: PostCardWithAnalysis }) {
  const title = post.title.replace(/^Show HN:\s*/i, "");
  const slug = slugify(post.title);
  const href = `/post/${post.id}/${slug}`;
  const tier = safeParseTier(post.analysis?.tier);
  const tags = safeParseJsonArray(post.analysis?.vibeTags);

  return (
    <Link href={href} prefetch={false} className="group block flex-1">
      <article className="rounded-lg border border-border bg-card overflow-hidden shadow-sm hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5 transition-all duration-200 p-4 h-full flex flex-col justify-center">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          {tier && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${tierBadgeStyles[tier] || ""}`}>
              <span className="tracking-tighter">{TIER_DOTS[tier]}</span>
              {TIER_LABELS[tier]}
            </span>
          )}
          {post.analysis?.category && (
            <span className="text-[10px] text-muted-foreground">{post.analysis.category}</span>
          )}
        </div>
        <h3 className="font-bold text-sm leading-snug mb-1.5 group-hover:text-primary transition-colors line-clamp-2">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground line-clamp-2 italic mb-2">
          {post.analysis?.pickReason || post.analysis?.summary || ""}
        </p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 2).map((tag) => (
              <span key={tag} className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${getVibeTagColor(tag)}`}>
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          <span>▲ {post.points}</span>
          {(post.comments ?? 0) > 0 && <span>💬 {post.comments}</span>}
        </div>
      </article>
    </Link>
  );
}
