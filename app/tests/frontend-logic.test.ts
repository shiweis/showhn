import test from "node:test";
import assert from "node:assert/strict";
import { filterHref } from "../src/lib/post-filters";
import { ftsQuery } from "../src/lib/search-query";
import { resolveDigestDay } from "../src/lib/digest-dates";
import { postSitemapFiles, sitemapIndexXml, urlSetXml } from "../src/lib/sitemap-xml";

test("filter links on the home page carry the chosen categories and leave out the defaults", () => {
  assert.equal(filterHref({ time: "week", sort: "newest", categories: [] }, false), "/");
  assert.equal(
    filterHref({ time: "month", sort: "newest", categories: ["AI/ML", "Data"] }, false),
    "/?t=month&cat=AI%2FML&cat=Data",
  );
});

test("filter links on a category page stay on that page and leave out its own defaults", () => {
  // A category page opens on All Time, Best Vibes.
  assert.equal(filterHref({ time: "all", sort: "interesting", categories: ["AI/ML"] }, true), "/category/ai-ml");
  assert.equal(
    filterHref({ time: "week", sort: "points", categories: ["AI/ML"] }, true),
    "/category/ai-ml?t=week&sort=points",
  );
  // Picking another category goes to its page with the same view.
  assert.equal(
    filterHref({ time: "week", sort: "interesting", categories: ["Developer Tools"] }, true),
    "/category/developer-tools?t=week",
  );
  // Clearing the category goes home and keeps what was on screen.
  assert.equal(filterHref({ time: "all", sort: "interesting", categories: [] }, true), "/?t=all&sort=interesting");
});

test("a search for several words matches posts that contain all of them, in any order", () => {
  assert.equal(ftsQuery("rust database", "all"), '"rust" "database"');
  assert.equal(ftsQuery("  Postgres   backup tool ", "all"), '"Postgres" "backup" "tool"');
});

test("quoted words in a search stay together as a phrase", () => {
  assert.equal(ftsQuery('"open source" cli', "all"), '"open source" "cli"');
});

test("a search can fall back to posts that contain any of the words", () => {
  assert.equal(ftsQuery("postgres backup tool", "any"), '"postgres" OR "backup" OR "tool"');
});

test("search operators and stray punctuation are treated as plain text, and an empty search is no query", () => {
  assert.equal(ftsQuery('title:x* NEAR(a b) say "hi', "all"), '"title:x*" "NEAR(a" "b)" "say" "hi"');
  assert.equal(ftsQuery('a "quote""inside" b', "all"), '"a" "quote" "inside" "b"');
  assert.equal(ftsQuery("  +  --  ", "all"), null);
  assert.equal(ftsQuery("", "any"), null);
});

test("a digest day must be a real date between the first post and today", () => {
  const earliest = "2026-02-10";
  const today = "2026-11-22";

  assert.equal(resolveDigestDay("2026-08-23", earliest, today), "2026-08-23");
  assert.equal(resolveDigestDay(earliest, earliest, today), earliest);
  assert.equal(resolveDigestDay(today, earliest, today), today);

  assert.equal(resolveDigestDay("2031-01-01", earliest, today), null); // the crawler trap
  assert.equal(resolveDigestDay("2026-02-09", earliest, today), null);
  assert.equal(resolveDigestDay("2026-02-30", earliest, today), null);
  assert.equal(resolveDigestDay("2026-8-23", earliest, today), null);
  assert.equal(resolveDigestDay("yesterday", earliest, today), null);
});

test("with no day asked for, the digest shows yesterday, the last complete day", () => {
  assert.equal(resolveDigestDay(undefined, "2026-02-10", "2026-11-22"), "2026-11-21");
  assert.equal(resolveDigestDay(undefined, "2026-11-22", "2026-11-22"), "2026-11-22");
});

test("posts are spread over sitemap files of 20,000, well under the 50,000-URL limit", () => {
  assert.deepEqual(postSitemapFiles(0), []);
  assert.deepEqual(postSitemapFiles(38_000), ["posts-0.xml", "posts-1.xml"]);
  assert.deepEqual(postSitemapFiles(40_000), ["posts-0.xml", "posts-1.xml"]);
  assert.deepEqual(postSitemapFiles(40_001), ["posts-0.xml", "posts-1.xml", "posts-2.xml"]);
});

test("the sitemap index lists each file once with an escaped address", () => {
  const xml = sitemapIndexXml("https://example.com", ["pages.xml", "posts-0.xml"], new Date("2026-11-22T10:00:00Z"));

  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  assert.ok(xml.includes("<sitemap><loc>https://example.com/sitemaps/pages.xml</loc><lastmod>2026-11-22T10:00:00.000Z</lastmod></sitemap>"));
  assert.ok(xml.includes("<loc>https://example.com/sitemaps/posts-0.xml</loc>"));
  assert.ok(xml.trimEnd().endsWith("</sitemapindex>"));
});

test("a sitemap file escapes addresses and keeps optional fields optional", () => {
  const xml = urlSetXml([
    { url: "https://example.com/search?q=a&b=<c>", lastModified: new Date("2026-11-22T10:00:00Z"), changeFrequency: "daily", priority: 0.8 },
    { url: "https://example.com/post/1/tiny-app" },
  ]);

  assert.ok(xml.includes("<loc>https://example.com/search?q=a&amp;b=&lt;c&gt;</loc>"));
  assert.ok(xml.includes("<lastmod>2026-11-22T10:00:00.000Z</lastmod><changefreq>daily</changefreq><priority>0.8</priority>"));
  assert.ok(xml.includes("<url><loc>https://example.com/post/1/tiny-app</loc></url>"));
  assert.ok(xml.trimEnd().endsWith("</urlset>"));
});
