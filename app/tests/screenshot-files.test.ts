import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasScreenshot, loadScreenshot } from "../scripts/lib/screenshot-files";

test("a thumbnail on disk is reported without being read, and loaded only on request", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "showhn-shots-"));
  try {
    fs.writeFileSync(path.join(dir, "7_thumb.webp"), "webp-bytes");

    assert.equal(hasScreenshot(7, dir), true);
    assert.equal(hasScreenshot(8, dir), false);
    assert.equal(hasScreenshot(-1, dir), false);
    assert.equal(loadScreenshot(7, dir), Buffer.from("webp-bytes").toString("base64"));
    assert.equal(loadScreenshot(8, dir), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
