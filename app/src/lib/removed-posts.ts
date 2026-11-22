/**
 * Posts removed at their author's request must stay removed even when the HN
 * search API returns them again. Which posts those are is deployment data, not
 * code: the ids live in REMOVED_POST_IDS in .env.local (comma-separated), so the
 * repository and its history do not record who asked to be removed.
 *
 * A value that is not a list of post ids throws. Ingest then stops instead of
 * silently letting a removed post back in.
 */
export function parseRemovedPostIds(value: string | undefined): Set<number> {
  const ids = new Set<number>();
  for (const part of (value ?? "").split(",")) {
    const text = part.trim();
    if (text === "") continue;
    if (!/^\d+$/.test(text)) {
      throw new Error(`REMOVED_POST_IDS must be a comma-separated list of post ids, got "${text}"`);
    }
    ids.add(Number(text));
  }
  return ids;
}
