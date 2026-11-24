import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { snapshotName, snapshotsToRemove, takeSnapshot } from "../src/lib/backup";

/** A folder for one test, removed afterwards. */
function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "showhn-backup-"));
  return run(dir).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

/** A small database in the same mode as the live one, with `posts` posts and one verdict fewer. */
function liveDatabase(dir: string, posts = 5): string {
  const file = path.join(dir, "live.db");
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec("CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL); CREATE TABLE ai_analysis (post_id INTEGER PRIMARY KEY, tier TEXT);");
  for (let id = 1; id <= posts; id += 1) {
    sqlite.prepare("INSERT INTO posts (id, title) VALUES (?, ?)").run(id, `Show HN: Invented project ${id}`);
    if (id > 1) sqlite.prepare("INSERT INTO ai_analysis (post_id, tier) VALUES (?, 'solid')").run(id);
  }
  sqlite.close();
  return file;
}

/** Unpacks a snapshot and opens it the way a restore would. */
function openSnapshot(dir: string, name: string) {
  const restored = path.join(dir, "restored.db");
  fs.writeFileSync(restored, zlib.gunzipSync(fs.readFileSync(path.join(dir, name))));
  return new Database(restored, { readonly: true });
}

const NIGHT = new Date("2027-01-15T03:40:00Z");

test("a snapshot is named after its day", () => {
  assert.equal(snapshotName(NIGHT), "showhn-2027-01-15.db.gz");
});

test("the newest seven snapshots are kept and other files are left alone", () => {
  const days = ["08", "09", "10", "11", "12", "13", "14", "15", "16"].map((day) => `showhn-2027-01-${day}.db.gz`);
  const others = ["showhn.db", "notes.txt", "showhn-2027-01-01.db", ".showhn-2027-01-16.db.gz.partial"];

  assert.deepEqual(snapshotsToRemove([...others, ...days].reverse()), ["showhn-2027-01-08.db.gz", "showhn-2027-01-09.db.gz"]);
  assert.deepEqual(snapshotsToRemove(days.slice(0, 7)), []);
});

test("a snapshot holds what the live database held and opens as one plain file", () =>
  withTempDir(async (dir) => {
    const live = liveDatabase(dir, 5);
    const backups = path.join(dir, "backups");

    const result = await takeSnapshot({ dbPath: live, dir: backups, now: NIGHT });

    assert.equal(result.file, "showhn-2027-01-15.db.gz");
    assert.deepEqual([result.posts, result.verdicts], [5, 4]);
    assert.equal(result.bytes, fs.statSync(path.join(backups, result.file)).size);
    const restored = openSnapshot(backups, result.file);
    try {
      assert.equal((restored.prepare("SELECT count(*) AS n FROM posts").get() as { n: number }).n, 5);
      assert.equal((restored.prepare("SELECT title FROM posts WHERE id = 3").get() as { title: string }).title, "Show HN: Invented project 3");
      // A restore should need this one file only, with no write-ahead log beside it.
      assert.equal(restored.pragma("journal_mode", { simple: true }), "delete");
    } finally {
      restored.close();
    }
  }));

test("nothing but the finished snapshot is left in the folder", () =>
  withTempDir(async (dir) => {
    const backups = path.join(dir, "backups");

    await takeSnapshot({ dbPath: liveDatabase(dir), dir: backups, now: NIGHT });

    assert.deepEqual(fs.readdirSync(backups), ["showhn-2027-01-15.db.gz"]);
  }));

test("the live database is not changed by taking a snapshot", () =>
  withTempDir(async (dir) => {
    const live = liveDatabase(dir);
    const before = fs.readFileSync(live);

    await takeSnapshot({ dbPath: live, dir: path.join(dir, "backups"), now: NIGHT });

    assert.ok(fs.readFileSync(live).equals(before));
  }));

test("snapshots older than the newest seven are removed once the new one is written", () =>
  withTempDir(async (dir) => {
    const backups = path.join(dir, "backups");
    fs.mkdirSync(backups);
    for (const day of ["07", "08", "09", "10", "11", "12", "13", "14"]) fs.writeFileSync(path.join(backups, `showhn-2027-01-${day}.db.gz`), "older");
    fs.writeFileSync(path.join(backups, "keep-me.txt"), "not a snapshot");

    const result = await takeSnapshot({ dbPath: liveDatabase(dir), dir: backups, now: NIGHT });

    assert.deepEqual(result.removed, ["showhn-2027-01-07.db.gz", "showhn-2027-01-08.db.gz"]);
    assert.deepEqual(
      fs.readdirSync(backups).sort(),
      ["keep-me.txt", ...["09", "10", "11", "12", "13", "14", "15"].map((day) => `showhn-2027-01-${day}.db.gz`)].sort(),
    );
  }));

test("a second snapshot on the same day replaces the first", () =>
  withTempDir(async (dir) => {
    const backups = path.join(dir, "backups");
    await takeSnapshot({ dbPath: liveDatabase(dir, 2), dir: backups, now: NIGHT });
    fs.rmSync(path.join(dir, "live.db"));

    const result = await takeSnapshot({ dbPath: liveDatabase(dir, 9), dir: backups, now: NIGHT });

    assert.equal(result.posts, 9);
    assert.deepEqual(fs.readdirSync(backups), ["showhn-2027-01-15.db.gz"]);
  }));

test("when the database cannot be read, no snapshot appears and the older ones stay", () =>
  withTempDir(async (dir) => {
    const backups = path.join(dir, "backups");
    fs.mkdirSync(backups);
    for (const day of ["06", "07", "08", "09", "10", "11", "12", "13"]) fs.writeFileSync(path.join(backups, `showhn-2027-01-${day}.db.gz`), "older");

    await assert.rejects(takeSnapshot({ dbPath: path.join(dir, "missing.db"), dir: backups, now: NIGHT }));

    assert.equal(fs.readdirSync(backups).length, 8, "nothing was added and nothing was removed");
  }));

test("a file that is not a database is refused, not packed as a snapshot", () =>
  withTempDir(async (dir) => {
    const broken = path.join(dir, "broken.db");
    fs.writeFileSync(broken, "this is not a database, only a text file of some length ".repeat(200));
    const backups = path.join(dir, "backups");

    await assert.rejects(takeSnapshot({ dbPath: broken, dir: backups, now: NIGHT }));

    assert.deepEqual(fs.existsSync(backups) ? fs.readdirSync(backups) : [], []);
  }));

test("git ignores the snapshot folder, so a copy of the database cannot be committed", () => {
  const rules = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8").split("\n").map((line) => line.trim());

  assert.ok(rules.includes("/data/backups/"), "app/.gitignore lists /data/backups/");
});

test("the cron wrapper has a backup job that logs what it did", () => {
  const cron = fs.readFileSync(path.join(__dirname, "..", "..", "deploy", "cron.sh"), "utf8");
  const body = /\n\s*backup\)\n([\s\S]*?)\n\s*;;/.exec(cron)?.[1] ?? "";

  assert.match(body, /scripts\/backup-db\.ts >> "\$LOG_DIR\/backup\.log" 2>&1/);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "scripts", "backup-db.ts")), "the script it runs exists");
});
