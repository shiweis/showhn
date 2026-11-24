"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { backTarget, LIST_TRAIL_KEY, rememberList } from "@/lib/back-to-browse";

/** The part of the browser's Navigation API this file reads. */
type NavigationLike = {
  currentEntry?: { index: number } | null;
  entries(): Array<{ url: string | null }>;
};

function readTrail(): string[] {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(LIST_TRAIL_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((url): url is string => typeof url === "string") : [];
  } catch {
    return [];
  }
}

/** The page before this one in the tab's history, when the browser can say and it is on this site. */
function previousUrl(): string | null {
  const navigation = (window as unknown as { navigation?: NavigationLike }).navigation;
  const index = navigation?.currentEntry?.index ?? -1;
  if (!navigation || index < 1) return null;
  try {
    const url = navigation.entries()[index - 1]?.url;
    if (!url) return null;
    const parsed = new URL(url);
    return parsed.origin === window.location.origin ? parsed.pathname + parsed.search : null;
  } catch {
    return null;
  }
}

/** Notes each list page the visitor looks at, so "Back to browse" can return to it. Draws nothing. */
export function RememberLists() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    try {
      const url = search ? `${pathname}?${search}` : pathname;
      window.sessionStorage.setItem(LIST_TRAIL_KEY, JSON.stringify(rememberList(readTrail(), url)));
    } catch {
      // Storage is off or full: the link falls back to the home page.
    }
  }, [pathname, search]);

  return null;
}

/** A link back to the list the visitor came from; the home page when there is none. */
export function BackToBrowse({ className = "mb-3" }: { className?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    // A click meant for a new tab or window is left to the browser.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = backTarget({ currentPath: pathname, previousUrl: previousUrl(), trail: readTrail() });
    if (target.kind === "back") {
      event.preventDefault();
      router.back();
    } else if (target.href !== "/") {
      event.preventDefault();
      router.push(target.href);
    }
  }

  return (
    <Link
      href="/"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors ${className}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
      Back to browse
    </Link>
  );
}
