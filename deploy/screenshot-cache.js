/**
 * Cache validators for screenshots. They let a browser or CDN ask "has this
 * file changed?" and get a short 304 answer, instead of downloading the image
 * again each time its cached copy expires.
 */

/** @param {{ size: number, mtimeMs: number }} stats */
function cacheValidators(stats) {
  // HTTP dates have one-second resolution, so both validators use whole seconds.
  const modified = Math.floor(stats.mtimeMs / 1000) * 1000;
  return {
    etag: `W/"${stats.size}-${modified.toString(36)}"`,
    lastModified: new Date(modified).toUTCString(),
  };
}

const opaqueTag = (tag) => tag.trim().replace(/^W\//, "");

/**
 * True when the request shows the client already holds this version.
 * If-None-Match decides when it is sent; the date is only a fallback.
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {{ etag: string, lastModified: string }} validators
 */
function isNotModified(headers, validators) {
  const noneMatch = headers["if-none-match"];
  if (typeof noneMatch === "string") {
    return noneMatch.split(",").map(opaqueTag).includes(opaqueTag(validators.etag));
  }
  const since = Date.parse(String(headers["if-modified-since"] ?? ""));
  return !Number.isNaN(since) && Date.parse(validators.lastModified) <= since;
}

module.exports = { cacheValidators, isNotModified };
