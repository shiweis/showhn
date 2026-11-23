/**
 * Pipeline health check, run from cron (`deploy/cron.sh health`).
 *
 * Prints one dated line saying whether new posts are arriving and getting
 * their verdict, and reports the same to HEALTH_PING_URL when that is set.
 * The rules are in src/lib/health.ts.
 *
 * Exit code: 0 when healthy, 1 when there is a problem, 2 when the check
 * itself broke.
 *
 * Usage:
 *   npm run health
 */

import path from "path";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import { runHealthCheck } from "../src/lib/health";

// Quiet, so the log holds one line per run.
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false, quiet: true });

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db");

async function main(): Promise<void> {
  let sqlite: Database.Database | undefined;
  try {
    const result = await runHealthCheck({
      open: () => {
        // Read-only: the check must not be able to change the data it watches.
        sqlite = new Database(DB_PATH, { readonly: true, fileMustExist: true });
        sqlite.pragma("busy_timeout = 5000");
        return sqlite;
      },
      pingUrl: process.env.HEALTH_PING_URL,
    });
    console.log(result.line);
    process.exitCode = result.healthy ? 0 : 1;
  } finally {
    sqlite?.close();
  }
}

main().catch((error) => {
  const stamp = `${new Date().toISOString().slice(0, 19)}Z`;
  console.error(`${stamp} PROBLEM | the health check itself failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
