import fs from "node:fs";
import path from "node:path";

const DEFAULT_SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");

/** Path of the generated thumbnail for a post, if one exists on disk. */
function thumbnailPath(postId: number, screenshotDir: string): string | undefined {
  if (!Number.isSafeInteger(postId) || postId < 0) return undefined;
  for (const ext of ["webp", "png"]) {
    const screenshotPath = path.join(screenshotDir, `${postId}_thumb.${ext}`);
    if (fs.existsSync(screenshotPath)) return screenshotPath;
  }
  return undefined;
}

/** Whether a post has a generated thumbnail, without reading it. */
export function hasScreenshot(postId: number, screenshotDir = DEFAULT_SCREENSHOT_DIR): boolean {
  return thumbnailPath(postId, screenshotDir) !== undefined;
}

/** Load a generated thumbnail from disk as base64. Worker/script use only. */
export function loadScreenshot(postId: number, screenshotDir = DEFAULT_SCREENSHOT_DIR): string | undefined {
  const screenshotPath = thumbnailPath(postId, screenshotDir);
  return screenshotPath ? fs.readFileSync(screenshotPath).toString("base64") : undefined;
}
