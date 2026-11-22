/**
 * Plain-text helpers for scraped pages. Kept free of imports: the fetchers and
 * the judge prompt both use it.
 */

const GITHUB_NAV_START = "Skip to content";
const GITHUB_NAV_END = "You must be signed in to change notification settings";

/**
 * The text of a GitHub repository page opens with its title and then about
 * 2,000 characters of GitHub's own navigation menu, which used to take up most
 * of the 3,000 characters the judge is shown. Cut the menu out and keep the
 * rest. Text that does not open this way is returned unchanged.
 */
export function stripGitHubChrome(pageText: string): string {
  const start = pageText.indexOf(GITHUB_NAV_START);
  // The menu follows the page title directly; a later match is some other page's own text.
  if (start < 0 || start > 600) return pageText;
  const end = pageText.indexOf(GITHUB_NAV_END, start);
  if (end < 0) return pageText;
  return pageText.slice(0, start) + pageText.slice(end + GITHUB_NAV_END.length).trimStart();
}

/**
 * The judge is told that everything between <project_evidence> tags is
 * untrusted. Text scraped from a project could contain the closing tag and
 * carry on as if it were instructions, so those tags are rewritten in square
 * brackets. The words themselves stay: they are evidence too.
 */
export function defuseEvidenceTags(text: string): string {
  return text.replace(/<\s*(\/?)\s*project_evidence\s*>/gi, "[$1project_evidence]");
}
