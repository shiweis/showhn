/**
 * The sitemap is an index at /sitemap.xml plus files under /sitemaps/. A
 * single file may hold 50,000 URLs, and the site was at 38,000 and growing by
 * about 1,000 a week.
 */

export const SITEMAP_POSTS_PER_FILE = 20_000;

export type SitemapEntry = {
  url: string;
  lastModified?: Date;
  changeFrequency?: "hourly" | "daily" | "weekly" | "monthly";
  priority?: number;
};

/** The post files the index lists. Posts go in by id, so a full file never changes again. */
export function postSitemapFiles(totalPosts: number): string[] {
  return Array.from({ length: Math.ceil(totalPosts / SITEMAP_POSTS_PER_FILE) }, (_, index) => `posts-${index}.xml`);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function sitemapIndexXml(baseUrl: string, files: string[], lastModified: Date): string {
  const items = files.map(
    (file) =>
      `<sitemap><loc>${escapeXml(`${baseUrl}/sitemaps/${file}`)}</loc><lastmod>${lastModified.toISOString()}</lastmod></sitemap>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</sitemapindex>\n`;
}

export function urlSetXml(entries: SitemapEntry[]): string {
  const items = entries.map(
    (entry) =>
      `<url><loc>${escapeXml(entry.url)}</loc>` +
      (entry.lastModified ? `<lastmod>${entry.lastModified.toISOString()}</lastmod>` : "") +
      (entry.changeFrequency ? `<changefreq>${entry.changeFrequency}</changefreq>` : "") +
      (entry.priority !== undefined ? `<priority>${entry.priority}</priority>` : "") +
      `</url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</urlset>\n`;
}
