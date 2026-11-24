import { Button } from "@/components/ui/button";

/** Points readers at the RSS feed of top picks. */
export function FeedBox() {
  return (
    <div className="border border-border rounded-lg p-6 bg-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h3 className="font-semibold flex items-center gap-2 mb-1">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
          Follow the top picks
        </h3>
        <p className="text-sm text-muted-foreground">
          Every gem and banger from Show HN, in your feed reader as they are picked.
        </p>
      </div>
      <Button asChild className="shrink-0">
        <a href="/feed.xml">RSS feed</a>
      </Button>
    </div>
  );
}
