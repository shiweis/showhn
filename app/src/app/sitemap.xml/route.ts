import { ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { postSitemapFiles, sitemapIndexXml } from "@/lib/sitemap-xml";

export const dynamic = "force-dynamic";

/** The sitemap index: one file of pages, then the posts in files of 20,000. */
export function GET(): Response {
  const row = db.select({ total: sql<number>`count(*)` }).from(posts).where(ne(posts.status, "dead")).get();
  const xml = sitemapIndexXml("https://hnshowcase.com", ["pages.xml", ...postSitemapFiles(row?.total ?? 0)], new Date());
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
