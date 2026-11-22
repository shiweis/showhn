import test from "node:test";
import assert from "node:assert/strict";

type Validators = { etag: string; lastModified: string };
// The screenshot server is a plain Node script outside the app; this is the module it uses.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { cacheValidators, isNotModified } = require("../../deploy/screenshot-cache.js") as {
  cacheValidators: (stats: { size: number; mtimeMs: number }) => Validators;
  isNotModified: (headers: Record<string, string | undefined>, validators: Validators) => boolean;
};

test("a screenshot is answered with 304 when the browser already holds that version", () => {
  const validators = cacheValidators({ size: 11874, mtimeMs: Date.UTC(2026, 10, 22, 16, 0, 0) + 250 });

  assert.equal(validators.lastModified, "Sun, 22 Nov 2026 16:00:00 GMT");
  assert.match(validators.etag, /^W\/"11874-[0-9a-z]+"$/);

  assert.equal(isNotModified({ "if-none-match": validators.etag }, validators), true);
  assert.equal(isNotModified({ "if-none-match": `"something-else", ${validators.etag}` }, validators), true);
  assert.equal(isNotModified({ "if-modified-since": validators.lastModified }, validators), true);
});

test("a screenshot is sent again when it changed or the browser has nothing to compare", () => {
  const validators = cacheValidators({ size: 11874, mtimeMs: Date.UTC(2026, 10, 22, 16, 0, 0) });
  const retaken = cacheValidators({ size: 12001, mtimeMs: Date.UTC(2026, 10, 23, 9, 0, 0) });

  assert.notEqual(validators.etag, retaken.etag);
  assert.equal(isNotModified({}, validators), false);
  assert.equal(isNotModified({ "if-none-match": validators.etag }, retaken), false);
  assert.equal(isNotModified({ "if-modified-since": "Sat, 21 Nov 2026 16:00:00 GMT" }, validators), false);
  // A version tag that does not match wins over a date that would.
  assert.equal(isNotModified({ "if-none-match": 'W/"1-1"', "if-modified-since": validators.lastModified }, validators), false);
  assert.equal(isNotModified({ "if-modified-since": "not a date" }, validators), false);
});
