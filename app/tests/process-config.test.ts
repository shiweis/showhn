import test from "node:test";
import assert from "node:assert/strict";

type Pm2App = { name: string; args?: string; log_date_format?: string };
// The PM2 process list is a plain Node file at the repository root, outside the app.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apps } = require("../../ecosystem.config.js") as { apps: Pm2App[] };

test("the site listens on this machine only, so the reverse proxy is the one way in", () => {
  const site = apps.find((app) => app.name === "hn-showcase");
  assert.ok(site, "hn-showcase is defined");

  // `next start` takes its address from --hostname alone. Without it the site listens on
  // every address, whatever a HOSTNAME variable says.
  assert.match(site.args ?? "", /(?:^|\s)--hostname 127\.0\.0\.1(?:\s|$)/);
});

test("the worker's log lines carry a date, a time and a UTC offset", () => {
  const worker = apps.find((app) => app.name === "hn-worker");
  assert.ok(worker, "hn-worker is defined");

  // PM2 writes this in front of every line the worker logs. The worker prints no times of
  // its own, so without it nothing in its log can be placed in time.
  assert.match(worker.log_date_format ?? "", /YYYY.*MM.*DD.*HH.*mm.*ss.*Z/);
});
