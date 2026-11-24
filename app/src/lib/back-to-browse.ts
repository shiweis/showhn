/**
 * Where "Back to browse" leads.
 *
 * The link used to go to the home page every time, which threw away the
 * filters, the category and the place in the list the visitor had come from.
 */

/** sessionStorage key for the list pages this tab has shown, newest last. */
export const LIST_TRAIL_KEY = "hn:list-trail";

const TRAIL_LENGTH = 3;
const LIST_PATHS = ["/", "/search", "/digest", "/divergence"];

function pathOf(url: string): string {
  return url.split(/[?#]/)[0] || "/";
}

/** Whether a path is one of the pages that list posts. */
export function isListPath(pathname: string): boolean {
  return LIST_PATHS.includes(pathname) || pathname.startsWith("/category/");
}

/** The trail with `url` added as the newest entry, if it is a list page. */
export function rememberList(trail: string[], url: string): string[] {
  if (!isListPath(pathOf(url))) return trail;
  return [...trail.filter((seen) => seen !== url), url].slice(-TRAIL_LENGTH);
}

export type BackTarget = { kind: "back" } | { kind: "go"; href: string };

/**
 * What the link should do on `currentPath`.
 *
 * `previousUrl` is the page before this one in the tab's history, or null when
 * there is none on this site or the browser cannot say. When that page is a
 * list, going back in history returns to it with its scroll position and the
 * cards it had loaded. Otherwise the link opens the list the visitor last
 * looked at, and the home page when there is none.
 */
export function backTarget({
  currentPath,
  previousUrl,
  trail,
}: {
  currentPath: string;
  previousUrl: string | null;
  trail: string[];
}): BackTarget {
  const here = pathOf(currentPath);
  if (previousUrl) {
    const before = pathOf(previousUrl);
    // A list of the same kind, such as an earlier search, is not "back to browse".
    if (isListPath(before) && before !== here) return { kind: "back" };
  }
  const lastList = [...trail].reverse().find((url) => pathOf(url) !== here);
  return { kind: "go", href: lastList ?? "/" };
}
