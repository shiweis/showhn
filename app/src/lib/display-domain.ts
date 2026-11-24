/**
 * The site a project lives on, as a card shows it: the host without "www.",
 * and for GitHub the owner and repository too. Null when the link is not a
 * web address, so that nothing but http and https links is ever rendered.
 */
export function displayDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (!host) return null;
  if (host === "github.com") {
    const [owner, repository] = parsed.pathname.split("/").filter(Boolean);
    return [host, owner, repository].filter(Boolean).join("/");
  }
  return host;
}
