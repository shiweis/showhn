import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const appDir = path.join(__dirname, "..", "src", "app");
const repoDir = path.join(__dirname, "..", "..");

/** Every file called `name` under `dir`, as paths relative to it. */
function find(dir: string, name: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return find(full, name, base);
    return entry.name === name ? [path.relative(base, full)] : [];
  });
}

test("only the list pages have a loading skeleton, so a missing post can answer 404", () => {
  // A loading file makes Next send the skeleton first, with status 200, before
  // the page has decided whether the post exists. Keeping the skeleton inside
  // the group of list pages leaves post pages free to answer 404.
  assert.deepEqual(find(appDir, "loading.tsx"), [path.join("(browse)", "loading.tsx")]);
});

test("the home page, the category pages and search are the list pages", () => {
  for (const page of ["page.tsx", path.join("category", "[slug]", "page.tsx"), path.join("search", "page.tsx")]) {
    assert.ok(fs.existsSync(path.join(appDir, "(browse)", page)), `${page} is in the list group`);
  }
  assert.ok(fs.existsSync(path.join(appDir, "post", "[id]", "[slug]", "page.tsx")), "the post page is outside it");
});

test("there is an icon for the iOS home screen", () => {
  const icon = fs.readFileSync(path.join(appDir, "apple-icon.png"));

  assert.equal(icon.subarray(1, 4).toString("latin1"), "PNG");
  assert.deepEqual([icon.readUInt32BE(16), icon.readUInt32BE(20)], [180, 180], "width and height");
});

test("there is an icon for browsers that do not draw SVG icons", () => {
  const icon = fs.readFileSync(path.join(appDir, "favicon.ico"));

  assert.deepEqual([icon.readUInt16LE(0), icon.readUInt16LE(2)], [0, 1], "an .ico header");
  assert.ok(icon.readUInt16LE(4) >= 1, "with at least one image");
});

test("no backup copies sit in the public folder, where the site would serve them", () => {
  const stray = fs.readdirSync(path.join(__dirname, "..", "public")).filter((name) => /\.(bak|orig|old|tmp)$/i.test(name));

  assert.deepEqual(stray, []);
});

test("ingest and the search-index rebuild start each cron run with a dated line", () => {
  const cron = fs.readFileSync(path.join(repoDir, "deploy", "cron.sh"), "utf8");

  for (const [job, log] of [["ingest", "ingest.log"], ["fts", "fts.log"]]) {
    const body = new RegExp(`\\n\\s*${job}\\)\\n([\\s\\S]*?)\\n\\s*;;`).exec(cron)?.[1] ?? "";
    const stampAt = body.indexOf(`"$LOG_DIR/${log}"`);
    const runAt = body.indexOf("tsx scripts/");
    assert.match(body, /^\s*stamp /m, `${job} calls stamp`);
    assert.ok(stampAt >= 0 && stampAt < runAt, `${job} writes the dated line to ${log} before it runs`);
  }
});

test("the dated line carries the date, the time in UTC and what is starting", () => {
  const cron = fs.readFileSync(path.join(repoDir, "deploy", "cron.sh"), "utf8");
  const stamp = /\nstamp\(\) \{\n[\s\S]*?\n\}/.exec(cron)?.[0];
  assert.ok(stamp, "cron.sh defines stamp()");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "showhn-cron-"));
  const log = path.join(dir, "ingest.log");

  try {
    execFileSync("bash", ["-c", `${stamp}\nstamp "ingest starts" "$1"`, "bash", log]);
    assert.match(fs.readFileSync(log, "utf8"), /^\[cron\] \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ ingest starts\n$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
