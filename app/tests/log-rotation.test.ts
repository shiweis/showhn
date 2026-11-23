import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type Pm2App = { name: string };
// The PM2 process list is a plain Node file at the repository root, outside the app.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apps } = require("../../ecosystem.config.js") as { apps: Pm2App[] };

const deployDir = path.join(__dirname, "..", "..", "deploy");

/** The rule without its comments: the log patterns before the brace, the settings inside it. */
function readRule() {
  const lines = fs
    .readFileSync(path.join(deployDir, "logrotate.conf"), "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
  const open = lines.indexOf("{");
  return { patterns: lines.slice(0, open), settings: lines.slice(open + 1, lines.lastIndexOf("}")) };
}

/** Whether a logrotate pattern (where `*` stands for any run of characters in a name) matches a path. */
function matches(pattern: string, file: string) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(file);
}

const covers = (patterns: string[], file: string) => patterns.some((pattern) => matches(pattern, file));

test("the rotation rule covers the logs PM2 keeps for every process of the site", () => {
  const { patterns } = readRule();
  const pm2Logs = patterns.find((pattern) => pattern.includes("/.pm2/logs/"));
  assert.ok(pm2Logs, "a pattern for PM2's log folder");
  const folder = path.dirname(pm2Logs);

  for (const { name } of apps) {
    // Fork mode writes <name>-out.log; cluster mode adds the instance number.
    for (const file of [`${name}-out.log`, `${name}-error.log`, `${name}-out-0.log`, `${name}-error-1.log`]) {
      assert.ok(covers(patterns, path.join(folder, file)), `${file} is rotated`);
    }
  }
});

test("the rotation rule covers every log the cron script writes", () => {
  const { patterns } = readRule();
  const cron = fs.readFileSync(path.join(deployDir, "cron.sh"), "utf8");
  const written = new Set([...cron.matchAll(/>> "\$LOG_DIR\/([\w.-]+)"/g)].map((match) => match[1]));
  assert.ok(written.size > 0, "the cron script appends to at least one log");

  const cronLogs = patterns.find((pattern) => !pattern.includes("/.pm2/") && path.basename(path.dirname(pattern)) === "logs");
  assert.ok(cronLogs, "a pattern for the repository's logs folder");
  for (const file of written) {
    assert.ok(covers(patterns, path.join(path.dirname(cronLogs), file)), `${file} is rotated`);
  }
});

test("the rotation rule empties a log in place, because nothing tells PM2 or cron to reopen it", () => {
  // PM2 keeps each log open and cron appends to the same path. If the file were renamed
  // instead, PM2 would go on writing into the old copy and the live log would stay empty.
  assert.ok(readRule().settings.includes("copytruncate"));
});

test("the rotation rule leaves its own old copies alone", () => {
  const { patterns } = readRule();
  const pm2Logs = patterns.find((pattern) => pattern.includes("/.pm2/logs/"));
  assert.ok(pm2Logs, "a pattern for PM2's log folder");

  // Old copies are named <log>-<date>.gz. A pattern that matched them would rotate them again.
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  assert.equal(covers(patterns, path.join(path.dirname(pm2Logs), `hn-worker-out.log-${date}.gz`)), false);
});
