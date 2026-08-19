import fs from "node:fs";
import path from "node:path";

const DEFAULT_SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");

/** Load a generated thumbnail from disk as base64. Worker/script use only. */
export function loadScreenshot(postId: number, screenshotDir = DEFAULT_SCREENSHOT_DIR): string | undefined {
  if (!Number.isSafeInteger(postId) || postId < 0) return undefined;
  for (const ext of ["webp", "png"]) {
    const screenshotPath = path.join(screenshotDir, `${postId}_thumb.${ext}`);
    if (fs.existsSync(screenshotPath)) {
      return fs.readFileSync(screenshotPath).toString("base64");
    }
  }
  return undefined;
}
