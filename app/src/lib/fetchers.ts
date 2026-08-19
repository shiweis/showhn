/**
 * Shared content-fetching and file-loading utilities.
 * Used by worker, rescore, and backfill scripts.
 */

import { fetchPublicResource } from "./public-url";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB max

/** Fetch a URL and extract text content from the HTML. */
export async function fetchPageContent(url: string): Promise<string> {
  try {
    const res = await fetchPublicResource(url, {
      timeoutMs: 10_000,
      maxBytes: MAX_RESPONSE_SIZE,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; HNShowcase/1.0; +https://hnshowcase.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return "";

    const contentType = res.headers.get("content-type")?.toLowerCase() || "";
    if (contentType && !contentType.startsWith("text/") && !contentType.includes("xhtml")) {
      return "";
    }

    const html = new TextDecoder().decode(res.body);

    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);
  } catch {
    return "";
  }
}

/** Parse a GitHub URL into owner/repo. Returns null for non-GitHub URLs. */
export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.hostname.toLowerCase() !== "github.com" && parsed.hostname.toLowerCase() !== "www.github.com") {
      return null;
    }
    const [ownerRaw, repoRaw] = parsed.pathname.split("/").filter(Boolean);
    if (!ownerRaw || !repoRaw) return null;
    const owner = decodeURIComponent(ownerRaw);
    const repo = decodeURIComponent(repoRaw).replace(/\.git$/, "");
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
    const specialPaths = ["marketplace", "explore", "sponsors", "topics", "settings", "orgs", "features", "enterprise", "pricing"];
    if (specialPaths.includes(owner.toLowerCase())) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

/** Fetch GitHub repo metadata (stars, language, description) via the GitHub API. */
export async function fetchGitHubMeta(
  owner: string,
  repo: string
): Promise<{ stars: number; language: string | null; description: string | null } | null> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "HNShowcase/1.0",
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetchPublicResource(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        timeoutMs: 10_000,
        maxBytes: 1024 * 1024,
        headers,
      },
    );

    if (!res.ok) return null;
    const data = JSON.parse(new TextDecoder().decode(res.body));

    return {
      stars: data.stargazers_count ?? 0,
      language: data.language ?? null,
      description: data.description ?? null,
    };
  } catch {
    return null;
  }
}

/** Fetch the README.md from a GitHub repo (tries main, then master branch). */
export async function fetchGitHubReadme(owner: string, repo: string): Promise<string> {
  for (const branch of ["main", "master"]) {
    try {
      const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${branch}/README.md`;
      const res = await fetchPublicResource(url, {
        timeoutMs: 5_000,
        maxBytes: 512 * 1024,
      });
      if (res.ok) {
        const text = new TextDecoder().decode(res.body);
        return text.slice(0, 5000);
      }
    } catch {
      // try next branch
    }
  }
  return "";
}
