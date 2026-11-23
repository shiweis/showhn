/**
 * Health check for the data pipeline: is ingest bringing in new posts, and are
 * new posts getting their verdict?
 *
 * Nothing else notices when either stops: PM2 shows the worker online while
 * every judge call fails, and the site keeps serving the posts it already
 * has. Analysis has stopped that way for days at a time before anyone saw it.
 *
 * The check reads the database only. `scripts/health-check.ts` runs it from
 * cron and reports the result to a ping address (see HEALTH_PING_URL in
 * .env.example), which is what turns a problem, or silence, into an email.
 */

import type Database from "better-sqlite3";

const HOUR = 60 * 60;

/**
 * The thresholds, in one place. They were set against nine months of the
 * site's own history. Replayed over it, the rules report every multi-day
 * analysis outage within 6 hours and every ingest outage, and otherwise speak
 * up twice, for one check each, when provider trouble cost posts their verdict.
 */
export const HEALTH_RULES = {
  /** A post this long after ingest should have its verdict. 99% get it within 10 minutes. */
  graceSeconds: 2 * HOUR,
  /** How many of the newest posts (older than the grace time) to look at... */
  sampleSize: 10,
  /** ...and how many of them must lack a verdict before analysis counts as stopped. */
  unjudgedLimit: 8,
  /** Ingest counts as stopped after this long without a new post. The longest ordinary pause was 4 hours. */
  quietSeconds: 6 * HOUR,
  /** Only posts created this recently count as new arrivals, which keeps a backfill of old posts out. */
  newPostSeconds: 48 * HOUR,
  /** How far back to look for the most common task error. */
  errorWindowSeconds: 24 * HOUR,
} as const;

export type PipelineState = {
  /** Unix seconds the state was read at. */
  now: number;
  /** How many posts were looked at: the newest ones ingested at least the grace time ago. */
  sample: number;
  /** How many of those have no verdict. */
  unjudged: number;
  /** When the newest new post was ingested; null when none arrived in the window. */
  newestPostAt: number | null;
  /** When a new post last got a verdict; null when none did in the window. */
  newestVerdictAt: number | null;
  /** The most common recent task error, cleaned for passing on; null when there is none. */
  commonError: string | null;
};

export type Assessment = {
  healthy: boolean;
  /** One entry per thing that is wrong, in plain words. Empty when healthy. */
  problems: string[];
  /** The whole result as one line. */
  line: string;
};

/**
 * Clean an error message for a log line or an alert: one line, no links, and
 * nothing shaped like a key or token. Provider errors sometimes quote the key
 * they rejected.
 */
export function scrubError(message: string): string {
  return message
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/gi, "<link>")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, "<hidden>")
    .replace(/[A-Za-z0-9_-]{24,}/g, "<hidden>")
    .trim()
    .slice(0, 120);
}

/** "12 min", "7 h" or "3 days". */
function span(seconds: number): string {
  if (seconds < 90 * 60) return `${Math.max(0, Math.round(seconds / 60))} min`;
  if (seconds < 48 * HOUR) return `${Math.floor(seconds / HOUR)} h`;
  return `${Math.floor(seconds / (24 * HOUR))} days`;
}

/** Read what the rules need. `now` is unix seconds. */
export function readPipelineState(sqlite: Database.Database, now: number): PipelineState {
  const newSince = now - HEALTH_RULES.newPostSeconds;

  const sample = sqlite
    .prepare(
      `SELECT (a.post_id IS NOT NULL) AS judged
       FROM posts p
       LEFT JOIN ai_analysis a ON a.post_id = p.id
       WHERE p.created_at >= ? AND p.fetched_at <= ? AND p.status != 'dead'
       ORDER BY p.fetched_at DESC, p.id DESC
       LIMIT ?`,
    )
    .all(newSince, now - HEALTH_RULES.graceSeconds, HEALTH_RULES.sampleSize) as Array<{ judged: number }>;
  const unjudged = sample.filter((row) => !row.judged).length;

  const newestPost = sqlite.prepare(`SELECT max(fetched_at) AS at FROM posts WHERE created_at >= ?`).get(newSince) as {
    at: number | null;
  };
  const newestVerdict = sqlite
    .prepare(
      `SELECT max(a.analyzed_at) AS at
       FROM posts p JOIN ai_analysis a ON a.post_id = p.id
       WHERE p.created_at >= ?`,
    )
    .get(newSince) as { at: number | null };

  // Only worth looking up when something is waiting.
  let commonError: string | null = null;
  if (unjudged > 0) {
    const row = sqlite
      .prepare(
        `SELECT error, count(*) AS n
         FROM task_queue
         WHERE type IN ('process', 'analyze') AND status IN ('pending', 'failed') AND error IS NOT NULL
           AND coalesce(completed_at, created_at) >= ?
         GROUP BY substr(error, 1, 60)
         ORDER BY n DESC
         LIMIT 1`,
      )
      .get(now - HEALTH_RULES.errorWindowSeconds) as { error: string } | undefined;
    commonError = row ? scrubError(row.error) : null;
  }

  return { now, sample: sample.length, unjudged, newestPostAt: newestPost.at, newestVerdictAt: newestVerdict.at, commonError };
}

/** Apply the rules to a state. */
export function assessPipeline(state: PipelineState): Assessment {
  const grace = `${HEALTH_RULES.graceSeconds / HOUR} h`;
  const window = `${HEALTH_RULES.newPostSeconds / HOUR} h`;
  const problems: string[] = [];

  if (state.unjudged >= HEALTH_RULES.unjudgedLimit) {
    const lastVerdict =
      state.newestVerdictAt === null
        ? `no new post got a verdict in the last ${window}`
        : `newest verdict ${span(state.now - state.newestVerdictAt)} ago`;
    const error = state.commonError ? `; most common error: ${state.commonError}` : "";
    problems.push(`${state.unjudged} of the ${state.sample} newest posts older than ${grace} have no verdict; ${lastVerdict}${error}`);
  }

  if (state.newestPostAt === null) {
    problems.push(`no new post in the last ${window}`);
  } else if (state.now - state.newestPostAt > HEALTH_RULES.quietSeconds) {
    problems.push(`no new post for ${span(state.now - state.newestPostAt)}`);
  }

  if (problems.length > 0) return { healthy: false, problems, line: problems.join("; ") };

  let verdicts: string;
  if (state.sample === 0) verdicts = `no post older than ${grace} to look at yet`;
  else if (state.unjudged === 0) verdicts = `the ${state.sample} newest posts older than ${grace} all have a verdict`;
  else verdicts = `${state.sample - state.unjudged} of the ${state.sample} newest posts older than ${grace} have a verdict`;
  const newestPost = `newest post ${span(state.now - (state.newestPostAt ?? state.now))} ago`;
  const newestVerdict = state.newestVerdictAt === null ? "" : `; newest verdict ${span(state.now - state.newestVerdictAt)} ago`;
  return { healthy: true, problems, line: `${verdicts}; ${newestPost}${newestVerdict}` };
}

type PingOptions = {
  fetchImpl?: typeof fetch;
  /** How many times to try before giving up. */
  attempts?: number;
  timeoutMs?: number;
  /** Pause before the second try; the third waits twice as long. */
  retryDelayMs?: number;
};

/**
 * Report the result to the ping address: the address itself when all is well,
 * with `/fail` added when it is not (the convention of Healthchecks.io and
 * compatible services). The result line travels as the request body, so the
 * alert says what is wrong.
 *
 * It never throws and never names the address, which works like a password.
 * If the ping cannot be sent at all, the service notices the silence instead.
 */
export async function sendPing(
  pingUrl: string | undefined,
  assessment: Assessment,
  { fetchImpl = fetch, attempts = 3, timeoutMs = 10_000, retryDelayMs = 2_000 }: PingOptions = {},
): Promise<{ sent: boolean; note: string }> {
  const base = (pingUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return { sent: false, note: "no ping address is set, so nobody is told" };
  const target = assessment.healthy ? base : `${base}/fail`;
  const withoutAddress = (text: string) => scrubError(text.split(base).join("<link>"));

  let reason = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(target, {
        method: "POST",
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: assessment.line,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        // The service answers 200 even for an address it does not know, and says so in the body.
        const answer = (await response.text()).trim().slice(0, 60);
        return { sent: true, note: answer === "OK" || answer === "" ? "ping sent" : `ping sent, but the service answered "${withoutAddress(answer)}"` };
      }
      reason = `HTTP ${response.status}`;
    } catch (error) {
      reason = error instanceof Error ? (error.name === "TimeoutError" ? "timed out" : error.message) : String(error);
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
  }
  return { sent: false, note: `ping failed after ${attempts} tries: ${withoutAddress(reason)}` };
}

type RunOptions = {
  /** Opens the database. A failure to open or read it is reported like any other problem. */
  open: () => Database.Database;
  /** Unix seconds; defaults to the clock. */
  now?: number;
  pingUrl?: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
};

/** One whole check: read, assess, report. Returns the dated line for the log. */
export async function runHealthCheck(options: RunOptions): Promise<{ healthy: boolean; line: string }> {
  const now = options.now ?? Math.floor(Date.now() / 1000);

  let assessment: Assessment;
  try {
    assessment = assessPipeline(readPipelineState(options.open(), now));
  } catch (error) {
    const problem = `the health check could not read the database: ${scrubError(error instanceof Error ? error.message : String(error))}`;
    assessment = { healthy: false, problems: [problem], line: problem };
  }

  const ping = await sendPing(options.pingUrl, assessment, { fetchImpl: options.fetchImpl, retryDelayMs: options.retryDelayMs });
  const stamp = `${new Date(now * 1000).toISOString().slice(0, 19)}Z`;
  return { healthy: assessment.healthy, line: `${stamp} ${assessment.healthy ? "ok" : "PROBLEM"} | ${assessment.line} | ${ping.note}` };
}
