import { TIER_LABELS, type Tier } from "./ai/tiers";
import { displayDomain } from "./display-domain";

const SITE = "https://hnshowcase.com";

/** What the feed needs to know about a post. A post card with its analysis has all of it. */
export type FeedPost = {
  id: number;
  title: string;
  url: string | null;
  author: string;
  points: number | null;
  comments: number | null;
  createdAt: number;
  analysis: {
    tier: string | null;
    category: string | null;
    pickReason: string | null;
    summary: string | null;
  } | null;
};

export type FeedItem = {
  title: string;
  link: string;
  published: Date;
  author: string;
  category: string | null;
  /** The entry's body as HTML. Everything taken from a post is escaped in it. */
  html: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Text made safe for an XML document: characters XML 1.0 cannot carry are dropped, the rest escaped. */
function xmlText(text: string): string {
  return text
    .replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/^show hn:\s*/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** One post as a feed entry: it links to the post's page here and carries the verdict and the outside links. */
export function feedItem(post: FeedPost): FeedItem {
  const analysis = post.analysis;
  const tier = analysis?.tier && analysis.tier in TIER_LABELS ? TIER_LABELS[analysis.tier as Tier] : null;
  const paragraphs: string[] = [];

  const verdict = [tier, analysis?.category].filter(Boolean).join(" · ");
  if (verdict) paragraphs.push(`<p><strong>${escapeHtml(verdict)}</strong></p>`);
  if (analysis?.pickReason && analysis.pickReason !== "Nothing stands out") {
    paragraphs.push(`<p>${escapeHtml(analysis.pickReason)}</p>`);
  }
  if (analysis?.summary) paragraphs.push(`<p>${escapeHtml(analysis.summary)}</p>`);

  const links: string[] = [];
  const domain = displayDomain(post.url);
  if (domain && post.url) links.push(`<a href="${escapeHtml(post.url)}">${escapeHtml(domain)}</a>`);
  links.push(
    `<a href="https://news.ycombinator.com/item?id=${post.id}">Hacker News thread</a> ` +
      `(${post.points ?? 0} points, ${post.comments ?? 0} comments)`,
  );
  paragraphs.push(`<p>${links.join(" · ")}</p>`);

  return {
    title: post.title.replace(/^Show HN:\s*/i, ""),
    link: `${SITE}/post/${post.id}/${slugify(post.title)}`,
    published: new Date(post.createdAt * 1000),
    author: post.author,
    category: analysis?.category ?? null,
    html: paragraphs.join(""),
  };
}

/** An RSS 2.0 document. */
export function rssXml({
  title,
  link,
  feedUrl,
  description,
  updated,
  items,
}: {
  title: string;
  link: string;
  feedUrl: string;
  description: string;
  updated: Date;
  items: FeedItem[];
}): string {
  const entries = items.map((item) =>
    [
      "<item>",
      `<title>${xmlText(item.title)}</title>`,
      `<link>${xmlText(item.link)}</link>`,
      `<guid isPermaLink="true">${xmlText(item.link)}</guid>`,
      `<pubDate>${item.published.toUTCString()}</pubDate>`,
      `<dc:creator>${xmlText(item.author)}</dc:creator>`,
      ...(item.category ? [`<category>${xmlText(item.category)}</category>`] : []),
      `<description>${xmlText(item.html)}</description>`,
      "</item>",
    ].join("\n"),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "<channel>",
    `<title>${xmlText(title)}</title>`,
    `<link>${xmlText(link)}</link>`,
    `<description>${xmlText(description)}</description>`,
    "<language>en</language>",
    `<lastBuildDate>${updated.toUTCString()}</lastBuildDate>`,
    `<atom:link href="${xmlText(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    ...entries,
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}
