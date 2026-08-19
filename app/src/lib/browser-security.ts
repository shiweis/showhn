import type { BrowserContext, Route } from "playwright";
import { assertPublicUrl } from "./public-url";

async function routePublicRequest(route: Route): Promise<void> {
  const requestUrl = route.request().url();
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    await route.abort("blockedbyclient");
    return;
  }

  // Browser-internal resource URLs do not leave the process.
  if (["data:", "blob:", "about:"].includes(parsed.protocol)) {
    await route.continue();
    return;
  }

  try {
    await assertPublicUrl(parsed);
    await route.continue();
  } catch {
    await route.abort("blockedbyclient");
  }
}

/** Block browser requests to private/local networks, including redirects and subresources. */
export async function installPublicNetworkGuard(context: BrowserContext): Promise<void> {
  await context.route("**/*", routePublicRequest);
}
