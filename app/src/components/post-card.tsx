import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import Link from "next/link";
import type { AnalysisCardData, PostCardData } from "@/lib/db/card-types";
import { TIERS, TIER_LABELS, TIER_DOTS, type Tier, getVibeTagColor } from "@/lib/ai/llm";
import { categoryToSlug } from "@/lib/categories";

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

// Tier styling — each tier gets a distinct color personality
const tierStyles: Record<string, { badge: string; border: string; text: string; accent: string }> = {
  gem: {
    badge: "bg-violet-500/90 text-white dark:bg-violet-400/90 dark:text-violet-950",
    border: "border-violet-400/60",
    text: "text-violet-600 dark:text-violet-400",
    accent: "border-t-[3px] border-t-violet-400 dark:border-t-violet-400",
  },
  banger: {
    badge: "bg-amber-500/90 text-white dark:bg-amber-400/90 dark:text-amber-950",
    border: "border-amber-400/60",
    text: "text-amber-600 dark:text-amber-400",
    accent: "border-t-[3px] border-t-amber-400 dark:border-t-amber-400",
  },
  solid: {
    badge: "bg-sky-500/90 text-white dark:bg-sky-400/90 dark:text-sky-950",
    border: "border-sky-400/60",
    text: "text-sky-600 dark:text-sky-400",
    accent: "border-t-2 border-t-sky-300 dark:border-t-sky-500",
  },
  mid: {
    badge: "bg-zinc-400/90 text-white dark:bg-zinc-500/90 dark:text-zinc-200",
    border: "border-zinc-300/60",
    text: "text-zinc-500 dark:text-zinc-400",
    accent: "",
  },
  pass: {
    badge: "bg-zinc-300/90 text-zinc-600 dark:bg-zinc-600/90 dark:text-zinc-300",
    border: "border-zinc-300/60",
    text: "text-zinc-400 dark:text-zinc-500",
    accent: "",
  },
};

const defaultTierStyle = { ...tierStyles.mid, accent: "" };

function getTierStyle(tier: string | null | undefined) {
  return tierStyles[tier || ""] || defaultTierStyle;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/^show hn:\s*/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function PostCard({
  post,
  analysis,
  compact,
}: {
  post: PostCardData;
  analysis?: AnalysisCardData | null;
  compact?: boolean;
}) {
  const slug = slugify(post.title);
  const href = `/post/${post.id}/${slug}`;
  const displayTitle = post.title.replace(/^Show HN:\s*/i, "");

  const tier = safeParseTier(analysis?.tier);
  const tierStyle = getTierStyle(tier);
  const vibeTags: string[] = safeParseJsonArray(analysis?.vibeTags);
  // Use highlight (pickReason) as the primary text, fall back to summary
  const highlight = analysis?.pickReason && analysis.pickReason !== "Nothing stands out"
    ? analysis.pickReason
    : analysis?.summary || null;

  return (
    <div className="group block relative">
      <article className={`rounded-lg border border-border bg-card overflow-hidden shadow-sm transition-all duration-200 hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5 dark:shadow-none dark:hover:shadow-md dark:hover:shadow-primary/5 dark:hover:border-primary/20 ${tierStyle.accent}`}>
        {/* Screenshot / GitHub card */}
        {compact ? (
          <div className="relative flex items-center justify-between px-3 pt-3">
            {analysis?.category && (
              <a href={`/category/${categoryToSlug(analysis.category)}`} className="relative z-10">
                <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-muted border border-border/50 hover:bg-muted/80 transition-colors">
                  {analysis.category}
                </Badge>
              </a>
            )}
            {tier && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${tierStyle.badge}`}>
                <span className="tracking-tighter">{TIER_DOTS[tier]}</span>
                {TIER_LABELS[tier]}
              </span>
            )}
          </div>
        ) : null}
        <div className={`relative aspect-[16/10] bg-muted overflow-hidden ${compact ? "hidden" : ""}`}>
          {post.githubStars != null ? (
            <div className="absolute inset-0 flex flex-col justify-center px-5 py-4 bg-gradient-to-br from-muted to-muted/80">
              <div className="flex items-center gap-1.5 text-muted-foreground/70 mb-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                <span className="text-xs font-medium">GitHub</span>
              </div>
              {post.githubDescription && (
                <p className="text-xs text-foreground/80 line-clamp-2 mb-3 leading-relaxed">{post.githubDescription}</p>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  {post.githubStars.toLocaleString()}
                </span>
                {post.githubLanguage && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-primary/60" />
                    {post.githubLanguage}
                  </span>
                )}
              </div>
            </div>
          ) : post.hasScreenshot ? (
            <Image
              src={`/screenshots/${post.id}_thumb.webp`}
              alt={displayTitle}
              fill
              className="object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            />
          ) : post.storyText ? (
            <div className="absolute inset-0 flex flex-col justify-center px-5 py-4 bg-gradient-to-br from-muted to-muted/80">
              <div className="flex items-center gap-1.5 text-muted-foreground/70 mb-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
                <span className="text-xs font-medium">Text Post</span>
              </div>
              <p className="text-xs text-foreground/80 line-clamp-4 leading-relaxed">
                {stripHtml(post.storyText).slice(0, 200)}
              </p>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/60">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
              <span className="text-[11px] mt-1.5">
                {post.status === "no_url" ? "Text post" : "Capturing..."}
              </span>
            </div>
          )}
          {analysis?.category && (
            <div className="absolute top-2 left-2 z-10">
              <a href={`/category/${categoryToSlug(analysis.category)}`} className="relative z-10">
                <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-background/85 backdrop-blur-sm border border-border/50 shadow-sm hover:bg-background/95 transition-colors">
                  {analysis.category}
                </Badge>
              </a>
            </div>
          )}
          {tier && (
            <div className="absolute top-2 right-2">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase shadow-sm backdrop-blur-sm ${tierStyle.badge}`}>
                <span className="tracking-tighter">{TIER_DOTS[tier]}</span>
                {TIER_LABELS[tier]}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-3">
          <h3 className="font-bold text-[0.935rem] leading-snug line-clamp-2 min-h-[2.6rem] mb-1.5 group-hover:text-primary transition-colors tracking-[-0.01em]">
            <Link href={href} className="after:absolute after:inset-0">
              {displayTitle}
            </Link>
          </h3>

          {/* Highlight — the star of the show */}
          {highlight ? (
            <p className="text-[11.5px] text-muted-foreground/80 line-clamp-3 min-h-[3.6rem] mb-2.5 leading-[1.55]">
              {highlight}
            </p>
          ) : (
            <p className="text-[11.5px] text-muted-foreground/80 line-clamp-3 min-h-[3.6rem] mb-2.5 leading-[1.55]">
              {post.storyText
                ? stripHtml(post.storyText).slice(0, 160)
                : "\u00A0"}
            </p>
          )}

          {/* Vibe tags */}
          <div className="flex flex-wrap gap-1 mb-2.5 min-h-[1.375rem]">
            {vibeTags.map((tag) => (
              <span
                key={tag}
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${getVibeTagColor(tag)}`}
              >
                {tag}
              </span>
            ))}
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="font-medium truncate mr-2">{post.author}</span>
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="inline-flex items-center gap-0.5 text-primary/70">
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                {post.points}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
                {post.comments}
              </span>
              <span>{timeAgo(post.createdAt)}</span>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}

export function PostCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="aspect-[16/10] bg-muted animate-pulse" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
        <div className="h-3 bg-muted rounded animate-pulse w-full" />
        <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
        <div className="h-3 bg-muted rounded animate-pulse w-40 pt-1" />
        <div className="flex justify-between pt-1">
          <div className="h-3 bg-muted rounded animate-pulse w-16" />
          <div className="h-3 bg-muted rounded animate-pulse w-24" />
        </div>
      </div>
    </div>
  );
}
