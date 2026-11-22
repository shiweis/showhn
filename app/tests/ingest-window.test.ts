import test from "node:test";
import assert from "node:assert/strict";
import { ingestWindows, resumeFrom } from "../src/lib/ingest-window";

const HOUR = 60 * 60;
const NOW = 1_800_000_000;

test("a regular ingest run re-reads the day before the newest stored post, to catch posts the search indexed late", () => {
  assert.equal(resumeFrom(NOW - 5 * 60, NOW), NOW - 5 * 60 - 24 * HOUR);
});

test("after an outage, ingest resumes from the newest stored post instead of losing everything older than two hours", () => {
  // The 26-hour hole of Aug 23-24: the last post stored is 26 hours old.
  assert.equal(resumeFrom(NOW - 26 * HOUR, NOW), NOW - 50 * HOUR);
});

test("with nothing stored yet, a regular run reads the last day", () => {
  assert.equal(resumeFrom(null, NOW), NOW - 24 * HOUR);
});

test("a long range is read in day-long windows with no gap and no overlap, oldest first", () => {
  const from = NOW - 60 * HOUR;
  assert.deepEqual(ingestWindows(from, NOW), [
    { from, to: from + 24 * HOUR },
    { from: from + 24 * HOUR, to: from + 48 * HOUR },
    { from: from + 48 * HOUR, to: NOW },
  ]);
});

test("a range shorter than a day is one window, and an empty range is none", () => {
  assert.deepEqual(ingestWindows(NOW - 2 * HOUR, NOW), [{ from: NOW - 2 * HOUR, to: NOW }]);
  assert.deepEqual(ingestWindows(NOW, NOW), []);
  assert.deepEqual(ingestWindows(NOW + HOUR, NOW), []);
});
