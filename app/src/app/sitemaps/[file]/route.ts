import { asc, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { CATEGORY_MAP } from "@/lib/categories";
import { SITEMAP_POSTS_PER_FILE, urlSetXml, type SitemapEntry } from "@/lib/sitemap-xml";

export const dynamic = "force-dynamic";

const BASE_URL = "https://hnshowcase.com";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/^show hn:\s*/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function pageEntries(): SitemapEntry[] {
  const now = new Date();
  return [
    { url: BASE_URL, lastModified: now, changeFrequency: "hourly", priority: 1.0 },
    { url: `${BASE_URL}/digest`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    ...Object.keys(CATEGORY_MAP).map((slug) => ({
      url: `${BASE_URL}/category/${slug}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    { url: `${BASE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/search`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
  ];
}

/** Posts go in by id, so a file that has filled up never changes again. */
function postEntries(fileIndex: number): SitemapEntry[] {
  return db
    .select({ id: posts.id, title: posts.title, updatedAt: posts.updatedAt })
    .from(posts)
    .where(ne(posts.status, "dead"))
    .orderBy(asc(posts.id))
    .limit(SITEMAP_POSTS_PER_FILE)
    .offset(fileIndex * SITEMAP_POSTS_PER_FILE)
    .all()
    .map((post) => ({
      url: `${BASE_URL}/post/${post.id}/${slugify(post.title)}`,
      lastModified: new Date(post.updatedAt * 1000),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));
}

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await context.params;
  const postFile = /^posts-(\d{1,4})\.xml$/.exec(file);
  const entries = file === "pages.xml" ? pageEntries() : postFile ? postEntries(Number(postFile[1])) : [];

  if (entries.length === 0) return new Response("Not found", { status: 404 });
  return new Response(urlSetXml(entries), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
