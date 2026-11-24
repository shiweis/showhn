import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";

/** How many nightly snapshots stay in the folder. */
export const SNAPSHOTS_KEPT = 7;

const SNAPSHOT_NAME = /^showhn-\d{4}-\d{2}-\d{2}\.db\.gz$/;

/** The file name of the snapshot for the UTC day `day` falls on. */
export function snapshotName(day: Date): string {
  return `showhn-${day.toISOString().slice(0, 10)}.db.gz`;
}

/** Which of `names` are snapshots older than the newest `keep`. Other files are never listed. */
export function snapshotsToRemove(names: string[], keep = SNAPSHOTS_KEPT): string[] {
  const snapshots = names.filter((name) => SNAPSHOT_NAME.test(name)).sort();
  return snapshots.slice(0, Math.max(0, snapshots.length - keep));
}

export type Snapshot = { file: string; bytes: number; posts: number; verdicts: number; removed: string[] };

/**
 * Writes a compressed copy of the database into `dir` and removes snapshots
 * older than the newest `keep`.
 *
 * The copy is taken through SQLite's own backup, so the site, ingest and the
 * worker can keep reading and writing while it runs. It is checked before it
 * is packed, written under a temporary name, and only renamed once complete:
 * a file called `showhn-<day>.db.gz` is always a whole, usable database. To
 * restore one, unpack it over `showhn.db` with the site and the worker stopped.
 */
export async function takeSnapshot({
  dbPath,
  dir,
  now = new Date(),
  keep = SNAPSHOTS_KEPT,
}: {
  dbPath: string;
  dir: string;
  now?: Date;
  keep?: number;
}): Promise<Snapshot> {
  const name = snapshotName(now);
  const copy = path.join(dir, `.${name}.copy`);
  const packed = path.join(dir, `.${name}.partial`);
  const leftovers = [copy, `${copy}-wal`, `${copy}-shm`, `${copy}-journal`, packed];

  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    fs.mkdirSync(dir, { recursive: true });
    await source.backup(copy);

    // Open the copy as a restore would. Switching it out of write-ahead mode
    // makes it one self-contained file.
    const check = new Database(copy);
    let posts: number;
    let verdicts: number;
    try {
      check.pragma("journal_mode = DELETE");
      const verdict = check.pragma("quick_check", { simple: true });
      if (verdict !== "ok") throw new Error(`the copy failed SQLite's check: ${String(verdict)}`);
      posts = (check.prepare("SELECT count(*) AS n FROM posts").get() as { n: number }).n;
      verdicts = (check.prepare("SELECT count(*) AS n FROM ai_analysis").get() as { n: number }).n;
    } finally {
      check.close();
    }

    await pipeline(fs.createReadStream(copy), zlib.createGzip(), fs.createWriteStream(packed));
    fs.renameSync(packed, path.join(dir, name));

    const removed = snapshotsToRemove(fs.readdirSync(dir), keep);
    for (const old of removed) fs.rmSync(path.join(dir, old));

    return { file: name, bytes: fs.statSync(path.join(dir, name)).size, posts, verdicts, removed };
  } finally {
    source.close();
    for (const leftover of leftovers) fs.rmSync(leftover, { force: true });
  }
}
