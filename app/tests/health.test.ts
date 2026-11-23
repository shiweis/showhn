import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { assessPipeline, readPipelineState, runHealthCheck, scrubError, sendPing } from "../src/lib/health";

const HOUR = 3600;
/** A fixed "now" for every test, in unix seconds. */
const NOW = 1_800_000_000;

type PostOptions = { hoursAgo: number; judged?: boolean; status?: string; createdHoursAgo?: number };

/** An empty database with the real schema, plus helpers to put posts and verdicts in it. */
function pipeline() {
  const sqlite = new Database(":memory:");
  migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const addPost = sqlite.prepare(
    "INSERT INTO posts (id, title, author, created_at, fetched_at, updated_at, status) VALUES (?, ?, 'maker', ?, ?, ?, ?)",
  );
  const addVerdict = sqlite.prepare("INSERT INTO ai_analysis (post_id, analyzed_at, model) VALUES (?, ?, 'test-model')");
  const addTask = sqlite.prepare(
    "INSERT INTO task_queue (type, post_id, status, attempts, created_at, completed_at, error) VALUES ('process', ?, ?, 3, ?, ?, ?)",
  );
  let nextId = 0;

  /** A post ingested `hoursAgo` hours before NOW. It gets its verdict a minute later unless `judged` is false. */
  function post({ hoursAgo, judged = true, status = "active", createdHoursAgo = hoursAgo }: PostOptions) {
    nextId += 1;
    const ingested = NOW - Math.round(hoursAgo * HOUR);
    addPost.run(nextId, `Show HN: Invented project ${nextId}`, NOW - Math.round(createdHoursAgo * HOUR), ingested, ingested, status);
    if (judged) addVerdict.run(nextId, ingested + 60);
    return nextId;
  }

  /** `count` posts spread evenly between `fromHoursAgo` and `toHoursAgo`. */
  function posts(count: number, fromHoursAgo: number, toHoursAgo: number, options: Omit<PostOptions, "hoursAgo"> = {}) {
    const ids: number[] = [];
    for (let i = 0; i < count; i += 1) {
      ids.push(post({ ...options, hoursAgo: fromHoursAgo - ((fromHoursAgo - toHoursAgo) * i) / Math.max(count - 1, 1) }));
    }
    return ids;
  }

  const failedTask = (postId: number, hoursAgo: number, error: string) =>
    addTask.run(postId, "failed", NOW - hoursAgo * HOUR, NOW - hoursAgo * HOUR, error);

  return { sqlite, post, posts, failedTask, assess: () => assessPipeline(readPipelineState(sqlite, NOW)) };
}

/** A stand-in for the network: records each request and answers from a list. */
function fakeNetwork(answers: Array<Response | Error>) {
  const requests: Array<{ url: string; method?: string; body?: string }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
    const answer = answers[Math.min(requests.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer.clone();
  };
  return { requests, fetchImpl: fetchImpl as typeof fetch };
}

const ok = () => new Response("OK", { status: 200 });

test("a pipeline that judges every new post is healthy", () => {
  const p = pipeline();
  p.posts(30, 12, 0.2);

  const result = p.assess();

  assert.equal(result.healthy, true);
  assert.deepEqual(result.problems, []);
  assert.match(result.line, /10 newest posts older than 2 h all have a verdict/);
});

test("posts that arrived over two hours ago and still have no verdict mean analysis has stopped", () => {
  const p = pipeline();
  p.posts(20, 12, 6);
  p.posts(9, 5.5, 2.5, { judged: false });

  const result = p.assess();

  assert.equal(result.healthy, false);
  assert.match(result.problems.join("; "), /9 of the 10 newest posts older than 2 h have no verdict/);
});

test("posts from the last two hours are not expected to have a verdict yet", () => {
  const p = pipeline();
  p.posts(20, 12, 3);
  p.posts(9, 1.5, 0.1, { judged: false });

  assert.equal(p.assess().healthy, true);
});

test("a few posts without a verdict are not an outage", () => {
  const p = pipeline();
  p.posts(20, 12, 6);
  p.posts(7, 5.5, 2.5, { judged: false });

  const result = p.assess();

  assert.equal(result.healthy, true);
  assert.match(result.line, /3 of the 10 newest posts older than 2 h have a verdict/);
});

test("posts that are dead on HN do not count as waiting for a verdict", () => {
  const p = pipeline();
  p.posts(20, 12, 6);
  p.posts(9, 5.5, 2.5, { judged: false, status: "dead" });

  assert.equal(p.assess().healthy, true);
});

test("old posts added by a backfill do not count as new arrivals", () => {
  const p = pipeline();
  p.posts(20, 12, 6);
  p.posts(9, 5.5, 2.5, { judged: false, createdHoursAgo: 30 * 24 });

  assert.equal(p.assess().healthy, true);
});

test("no new post for more than six hours means ingest has stopped", () => {
  const p = pipeline();
  p.posts(20, 20, 7);

  const result = p.assess();

  assert.equal(result.healthy, false);
  assert.match(result.problems.join("; "), /no new post for 7 h/);
});

test("an ordinary overnight pause in new posts is not an alert", () => {
  const p = pipeline();
  p.posts(20, 20, 4);

  assert.equal(p.assess().healthy, true);
});

test("a database with no recent post at all is reported, not passed as healthy", () => {
  const result = pipeline().assess();

  assert.equal(result.healthy, false);
  assert.match(result.problems.join("; "), /no new post/);
});

test("the report names the most common recent error", () => {
  const p = pipeline();
  p.posts(20, 12, 6);
  const waiting = p.posts(9, 5.5, 2.5, { judged: false });
  for (const id of waiting.slice(0, 6)) p.failedTask(id, 3, "401 the key was rejected by the provider");
  for (const id of waiting.slice(6)) p.failedTask(id, 3, "Missing from batch response");
  // An old failure of another kind must not be picked up.
  for (let i = 0; i < 12; i += 1) p.failedTask(waiting[0], 72, "an error from three days ago");

  assert.match(p.assess().problems.join("; "), /most common error: 401 the key was rejected by the provider/);
});

test("keys and links in an error message are not passed on", () => {
  // An invented key, put together here so that no key-shaped text sits in the repository.
  const key = ["sk", "proj", "Abc123Def456Ghi789Jkl012Mno345"].join("-");
  const scrubbed = scrubError(`401 Incorrect API key provided: ${key}. See https://provider.example/account/keys?org=acme  for\n details`);

  assert.equal(scrubbed.includes("sk-proj"), false);
  assert.equal(scrubbed.includes("Abc123"), false);
  assert.equal(scrubbed.includes("provider.example"), false);
  assert.match(scrubbed, /^401 Incorrect API key provided: \S+ See <link> for details$/);
});

test("a long error message is cut short", () => {
  assert.ok(scrubError("word ".repeat(200)).length <= 120);
});

test("a healthy result pings the address as it is", async () => {
  const net = fakeNetwork([ok()]);

  const ping = await sendPing("https://ping.example/abc/", { healthy: true, problems: [], line: "all well" }, { fetchImpl: net.fetchImpl });

  assert.equal(ping.sent, true);
  assert.deepEqual(net.requests, [{ url: "https://ping.example/abc", method: "POST", body: "all well" }]);
});

test("a problem pings the failure address and carries the reason", async () => {
  const net = fakeNetwork([ok()]);

  await sendPing("https://ping.example/abc", { healthy: false, problems: ["verdicts have stopped"], line: "verdicts have stopped" }, { fetchImpl: net.fetchImpl });

  assert.deepEqual(net.requests, [{ url: "https://ping.example/abc/fail", method: "POST", body: "verdicts have stopped" }]);
});

test("without a ping address nothing is sent, and the result says so", async () => {
  const net = fakeNetwork([ok()]);

  const ping = await sendPing("  ", { healthy: true, problems: [], line: "all well" }, { fetchImpl: net.fetchImpl });

  assert.equal(ping.sent, false);
  assert.equal(net.requests.length, 0);
  assert.match(ping.note, /no ping address/);
});

test("a ping that fails is tried again", async () => {
  const net = fakeNetwork([new Error("connection reset"), new Response("busy", { status: 503 }), ok()]);

  const ping = await sendPing("https://ping.example/abc", { healthy: true, problems: [], line: "all well" }, { fetchImpl: net.fetchImpl, retryDelayMs: 0 });

  assert.equal(ping.sent, true);
  assert.equal(net.requests.length, 3);
});

test("a ping that keeps failing is reported without throwing and without the address", async () => {
  const net = fakeNetwork([new Error("request to https://ping.example/abc failed")]);

  const ping = await sendPing("https://ping.example/abc", { healthy: true, problems: [], line: "all well" }, { fetchImpl: net.fetchImpl, retryDelayMs: 0 });

  assert.equal(ping.sent, false);
  assert.equal(net.requests.length, 3);
  assert.match(ping.note, /ping failed after 3 tries/);
  assert.equal(ping.note.includes("ping.example"), false);
});

test("an answer other than a plain OK is passed on, since the service answers 200 for an address it does not know", async () => {
  const net = fakeNetwork([new Response("OK (not found)", { status: 200 })]);

  const ping = await sendPing("https://ping.example/typo", { healthy: true, problems: [], line: "all well" }, { fetchImpl: net.fetchImpl });

  assert.match(ping.note, /the service answered "OK \(not found\)"/);
});

test("a full run writes one dated line and sends the matching ping", async () => {
  const p = pipeline();
  p.posts(30, 12, 0.2);
  const net = fakeNetwork([ok()]);

  const run = await runHealthCheck({ open: () => p.sqlite, now: NOW, pingUrl: "https://ping.example/abc", fetchImpl: net.fetchImpl });

  assert.equal(run.healthy, true);
  assert.match(run.line, /^2027-01-15T08:00:00Z ok \| .* \| ping sent$/);
  assert.equal(net.requests[0].url, "https://ping.example/abc");
});

test("the cron wrapper runs the health check and keeps what it reports", () => {
  const cron = fs.readFileSync(path.join(__dirname, "..", "..", "deploy", "cron.sh"), "utf8");
  const health = /\n\s*health\)\n([\s\S]*?)\n\s*;;/.exec(cron)?.[1] ?? "";

  // Nothing else starts the check, so a wrapper that stops calling it would end the alerts in silence.
  assert.match(health, /scripts\/health-check\.ts >> "\$LOG_DIR\/health\.log" 2>&1/);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "scripts", "health-check.ts")), "the script it runs exists");
});

test("a database that cannot be read is itself reported as a failure", async () => {
  const net = fakeNetwork([ok()]);

  const run = await runHealthCheck({
    open: () => {
      throw new Error("unable to open database file");
    },
    now: NOW,
    pingUrl: "https://ping.example/abc",
    fetchImpl: net.fetchImpl,
  });

  assert.equal(run.healthy, false);
  assert.match(run.line, /PROBLEM \| the health check could not read the database: unable to open database file/);
  assert.equal(net.requests[0].url, "https://ping.example/abc/fail");
});
