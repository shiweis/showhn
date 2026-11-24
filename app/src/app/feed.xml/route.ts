import { getFeedPosts } from "@/lib/db/queries";
import { feedItem, rssXml } from "@/lib/feed-xml";

export const dynamic = "force-dynamic";

/** The newest gems and bangers as an RSS feed. */
export async function GET() {
  const posts = await getFeedPosts();
  const xml = rssXml({
    title: "HN Showcase: top picks",
    link: "https://hnshowcase.com/",
    feedUrl: "https://hnshowcase.com/feed.xml",
    description: "The gems and bangers from Show HN, as rated by HN Showcase.",
    updated: posts[0] ? new Date(posts[0].createdAt * 1000) : new Date(),
    items: posts.map(feedItem),
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      // Feed readers ask again and again; a quarter of an hour is fresh enough.
      "Cache-Control": "public, max-age=900",
    },
  });
}
