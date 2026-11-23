// PM2 process configuration for HN Showcase.
//
// Defines the three processes that run the site:
//   - hn-showcase  — Next.js production server on 127.0.0.1:3333 (cluster mode)
//   - hn-static    — static file server for /screenshots/* on 127.0.0.1:3334 (cluster mode)
//   - hn-worker    — long-running task-queue worker (fork mode)
//
// Path-portable: all paths are resolved relative to this file's location, so
// the same config works whether the repo is checked out at
// /root/clawd/projects/showhn (legacy old-box layout) or /home/shiwei/showhn-src
// (new VPS layout, runs as the shiwei user).
//
// Usage:
//   pm2 start ecosystem.config.js          # start all three
//   pm2 reload ecosystem.config.js          # zero-downtime reload (cluster mode)
//   pm2 save                                # persist for `pm2 resurrect` on boot
//
// First-time per-user setup (one-time, generates the systemd unit):
//   pm2 startup systemd -u <user> --hp /home/<user>
//   (then run the sudo command pm2 emits)

const path = require("path");

const repoRoot = __dirname;
const appDir = path.join(repoRoot, "app");

module.exports = {
  apps: [
    {
      name: "hn-static",
      script: "./deploy/static-server.js",
      cwd: repoRoot,
      exec_mode: "cluster",
      instances: 1,
      // STATIC_PORT defaults to 3334 in the script; override here if needed
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "hn-showcase",
      script: "./node_modules/.bin/next",
      // Listens on this machine only; the reverse proxy is the one way in.
      // `next start` takes its address from --hostname alone and ignores a
      // HOSTNAME variable: without the flag it listens on every address.
      args: "start --hostname 127.0.0.1",
      cwd: appDir,
      exec_mode: "cluster",
      instances: 1,
      env: {
        NODE_ENV: "production",
        PORT: "3333",
      },
    },
    {
      name: "hn-worker",
      script: "./node_modules/.bin/tsx",
      args: "scripts/worker.ts",
      cwd: appDir,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      // Worker is long-running; restart with exponential backoff if it dies
      max_restarts: 10,
      min_uptime: "30s",
    },
  ],
};
