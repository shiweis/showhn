/**
 * Adopt versioned migrations for a database that predates the migration log.
 * This records the latest checked-in migration only after validating that the
 * live schema already contains every required table and column.
 */

import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

if (!process.argv.includes("--yes")) {
  throw new Error("Refusing to modify migration metadata without --yes; back up the database first");
}

const databasePath = path.resolve(
  process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db"),
);
if (!fs.existsSync(databasePath) || !fs.statSync(databasePath).isFile()) {
  throw new Error(`Database does not exist: ${databasePath}`);
}

const requiredSchema: Record<string, string[]> = {
  posts: ["id", "page_content", "readme_content", "github_stars", "github_updated_at"],
  ai_analysis: ["post_id", "pick_reason", "pick_score", "tier", "vibe_tags", "strengths", "weaknesses", "similar_to"],
  task_queue: ["id", "status", "attempts", "max_attempts", "started_at", "completed_at"],
  subscribers: ["id", "email", "frequency", "created_at"],
};

const sqlite = new Database(databasePath);
try {
  for (const [table, columns] of Object.entries(requiredSchema)) {
    const existing = new Set(
      (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
        .map((column) => column.name),
    );
    const missing = columns.filter((column) => !existing.has(column));
    if (missing.length > 0) {
      throw new Error(`Cannot baseline: missing ${table}.${missing.join(`, ${table}.`)}`);
    }
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);
  const existingCount = sqlite
    .prepare("SELECT count(*) FROM __drizzle_migrations")
    .pluck()
    .get() as number;
  if (existingCount > 0) {
    console.log(`[baseline] Migration log already contains ${existingCount} row(s); no changes made`);
    process.exitCode = 0;
  } else {
    const migrations = readMigrationFiles({ migrationsFolder: path.join(process.cwd(), "drizzle") });
    const latest = migrations.at(-1);
    if (!latest) throw new Error("No checked-in migrations found");
    sqlite.prepare(
      "INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)",
    ).run(latest.hash, latest.folderMillis);
    console.log(`[baseline] Recorded schema baseline at ${latest.folderMillis}`);
  }
} finally {
  sqlite.close();
}
