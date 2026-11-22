/**
 * Turns what a visitor typed into an FTS5 MATCH expression.
 */

const MAX_TERMS = 12;

/**
 * Words are matched individually, so "rust database" finds posts that contain
 * both words anywhere, not only that exact phrase. Words inside double quotes
 * stay together as a phrase. Every term is quoted, which turns FTS5 operators
 * (*, OR, NEAR, column filters) into plain text. `all` requires every term,
 * `any` at least one. Returns null when nothing searchable was typed.
 */
export function ftsQuery(query: string, match: "all" | "any"): string | null {
  const terms: string[] = [];
  for (const part of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    const text = (part[1] ?? part[2]).replace(/"/g, " ").replace(/\s+/g, " ").trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    terms.push(`"${text}"`);
    if (terms.length === MAX_TERMS) break;
  }
  if (terms.length === 0) return null;
  return terms.join(match === "all" ? " " : " OR ");
}
