import test from "node:test";
import assert from "node:assert/strict";

type Pm2App = { name: string; args?: string };
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
