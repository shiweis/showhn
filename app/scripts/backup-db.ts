/**
 * Nightly snapshot of the database: a compressed copy in data/backups, the
 * newest seven kept. Prints one dated line saying what it wrote, or why it
 * could not.
 *
 * Run by cron through deploy/cron.sh, or by hand with `npm run backup`.
 *
 * The snapshots are on the same disk as the database. They cover a bad
 * migration, a wrong bulk update or a damaged file, not the loss of the disk;
 * for that, copy the folder somewhere else as well.
 */
import path from "path";
import { takeSnapshot } from "../src/lib/backup";

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "showhn.db");
const dir = process.env.BACKUP_DIR || path.join(process.cwd(), "data", "backups");

async function main() {
  const started = Date.now();
  const at = () => new Date().toISOString().slice(0, 19) + "Z";
  try {
    const snapshot = await takeSnapshot({ dbPath, dir });
    const megabytes = (snapshot.bytes / 1024 / 1024).toFixed(1);
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(
      `${at()} backup ok | ${snapshot.file}, ${megabytes} MB, ${snapshot.posts} posts, ${snapshot.verdicts} verdicts | ` +
        `${snapshot.removed.length} older removed | ${seconds} s`,
    );
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 200);
    console.log(`${at()} backup FAILED | ${reason}`);
    process.exitCode = 1;
  }
}

main();
