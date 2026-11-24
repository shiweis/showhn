import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { feedItem, rssXml } from "../src/lib/feed-xml";

const post = {
  id: 4242,
  title: "Show HN: Widget & <Gadget> \u{1F680}",
  url: "https://www.example.com/?a=1&b=2",
  author: "maker",
  points: 120,
  comments: 34,
  createdAt: 1_800_000_000,
  analysis: {
    tier: "gem",
    category: "Developer Tools",
    pickReason: 'Does one thing, and says "no" to the rest.',
    summary: "A small tool for <b>bold</b> claims.\u0007",
  },
};

test("a feed entry links to the post's page and carries the verdict, the project and the HN thread", () => {
  const item = feedItem(post);

  assert.equal(item.title, "Widget & <Gadget> \u{1F680}");
  assert.equal(item.link, "https://hnshowcase.com/post/4242/widget-gadget");
  assert.equal(item.published.toISOString(), "2027-01-15T08:00:00.000Z");
  assert.match(item.html, /Gem/);
  assert.match(item.html, /Developer Tools/);
  assert.match(item.html, /Does one thing, and says &quot;no&quot; to the rest\./);
  assert.match(item.html, /A small tool for &lt;b&gt;bold&lt;\/b&gt; claims\./, "text from a post is never passed on as markup");
  assert.match(item.html, /<a href="https:\/\/www\.example\.com\/\?a=1&amp;b=2">example\.com<\/a>/);
  assert.match(item.html, /<a href="https:\/\/news\.ycombinator\.com\/item\?id=4242">Hacker News thread<\/a> \(120 points, 34 comments\)/);
});

test("a post without a web address gets no project link", () => {
  const item = feedItem({ ...post, url: "javascript:alert(1)" });

  assert.equal(item.html.includes("javascript:"), false);
  assert.match(item.html, /Hacker News thread/);
});

test("the feed is well-formed RSS whatever the titles contain", () => {
  const xml = rssXml({
    title: "HN Showcase: top picks",
    link: "https://hnshowcase.com/",
    feedUrl: "https://hnshowcase.com/feed.xml",
    description: "Gems & bangers",
    updated: new Date("2027-01-15T09:00:00Z"),
    items: [feedItem(post)],
  });

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0"/);
  assert.match(xml, /<atom:link href="https:\/\/hnshowcase\.com\/feed\.xml" rel="self" type="application\/rss\+xml"\/>/);
  assert.match(xml, /<description>Gems &amp; bangers<\/description>/);
  assert.match(xml, /<lastBuildDate>Fri, 15 Jan 2027 09:00:00 GMT<\/lastBuildDate>/);
  assert.match(xml, /<title>Widget &amp; &lt;Gadget&gt; \u{1F680}<\/title>/u);
  assert.match(xml, /<guid isPermaLink="true">https:\/\/hnshowcase\.com\/post\/4242\/widget-gadget<\/guid>/);
  assert.match(xml, /<pubDate>Fri, 15 Jan 2027 08:00:00 GMT<\/pubDate>/);
  assert.match(xml, /<category>Developer Tools<\/category>/);
  // The entry's HTML travels as escaped text.
  assert.match(xml, /<description>&lt;p&gt;/);
  assert.equal(xml.includes("\u0007"), false, "characters XML cannot carry are dropped");
  // Nothing is left unescaped: every & starts one of the five XML entities.
  assert.equal(/&(?!(amp|lt|gt|quot|apos);)/.test(xml), false);
  assert.equal(xml.split("<item>").length - 1, 1);
});

test("an empty feed is still a valid document", () => {
  const xml = rssXml({ title: "t", link: "https://hnshowcase.com/", feedUrl: "https://hnshowcase.com/feed.xml", description: "d", updated: new Date(0), items: [] });

  assert.match(xml, /<channel>[\s\S]*<\/channel>\n<\/rss>\n$/);
  assert.equal(xml.includes("<item>"), false);
});

test("the feed lists the newest gems and bangers that are still live", async () => {
  process.env.DATABASE_PATH = ":memory:";
  const { sqlite } = await import("../src/lib/db/index");
  const { getFeedPosts } = await import("../src/lib/db/queries");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const addPost = sqlite.prepare(
    "INSERT INTO posts (id, title, author, points, comments, created_at, fetched_at, updated_at, status) VALUES (?, ?, 'maker', 1, 0, ?, ?, ?, ?)",
  );
  const addVerdict = sqlite.prepare("INSERT INTO ai_analysis (post_id, analyzed_at, model, tier, pick_score) VALUES (?, 1, 'test-model', ?, 50)");
  const rows: [number, string, number, string][] = [
    [1, "gem", 100, "active"],
    [2, "banger", 300, "active"],
    [3, "solid", 400, "active"],
    [4, "banger", 500, "dead"],
    [5, "gem", 200, "no_url"],
    [6, "mid", 600, "active"],
  ];
  for (const [id, tier, created, status] of rows) {
    addPost.run(id, `Show HN: Invented project ${id}`, created, created, created, status);
    addVerdict.run(id, tier);
  }
  addPost.run(7, "Show HN: Not judged yet", 700, 700, 700, "active");

  assert.deepEqual((await getFeedPosts()).map((post) => post.id), [2, 5, 1]);
  assert.deepEqual((await getFeedPosts(2)).map((post) => post.id), [2, 5]);
});

test("every page tells feed readers where the feed is", () => {
  const layout = fs.readFileSync(path.join(__dirname, "..", "src", "app", "layout.tsx"), "utf8");

  assert.match(layout, /rel="alternate"\s+type="application\/rss\+xml"[^>]*href="\/feed\.xml"/);
});

test("the digest page offers the feed and no longer promises an email", () => {
  const digest = fs.readFileSync(path.join(__dirname, "..", "src", "app", "digest", "page.tsx"), "utf8");
  const sources = [digest, ...fs.readdirSync(path.join(__dirname, "..", "src", "components")).filter((name) => name.endsWith(".tsx")).map((name) => fs.readFileSync(path.join(__dirname, "..", "src", "components", name), "utf8"))].join("\n");

  assert.match(digest, /<FeedBox \/>/);
  assert.equal(/coming soon/i.test(sources), false);
});
