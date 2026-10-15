import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clipRequest,
  clipTimesFromMarks,
  combineRequest,
  formatMediaTimestamp,
  isMineMp4Key,
  parseMediaTimestamp,
  suggestEditName,
} from "../frontend/videoEdit.js";

test("clip times accept seconds, minutes, and hours", () => {
  assert.equal(parseMediaTimestamp("90"), 90);
  assert.equal(parseMediaTimestamp("1:30"), 90);
  assert.equal(parseMediaTimestamp("1:02:15"), 3735);
  assert.equal(parseMediaTimestamp("0:01:30.5"), 90.5);
  assert.throws(() => parseMediaTimestamp("1:75"), /1:30/);
  assert.throws(() => parseMediaTimestamp("-2"), /out of range/);
  const body = clipRequest("users/abc/Videos/Race.mp4", "0:10", "1:00", "Race highlight");
  assert.equal(body.kind, "clip");
  assert.equal(body.start, "0:10");
  assert.equal(body.end, "1:00");
  assert.throws(() => clipRequest("users/abc/Videos/Race.mp4", "2:00", "1:00", "Race"), /after the start/);
});

test("player marks become clip start and end times", () => {
  assert.equal(formatMediaTimestamp(90), "0:01:30");
  assert.equal(formatMediaTimestamp(3735.5), "1:02:15.5");
  assert.equal(parseMediaTimestamp(formatMediaTimestamp(90.5)), 90.5);
  const marked = clipTimesFromMarks(10, 60);
  assert.equal(marked.start, "0:00:10");
  assert.equal(marked.end, "0:01:00");
  assert.throws(() => clipTimesFromMarks(null, 12), /start of the clip/);
  assert.throws(() => clipTimesFromMarks(12, null), /end of the clip/);
  assert.throws(() => clipTimesFromMarks(60, 10), /after the start/);
});

test("combine needs two mp4s and a new name", () => {
  assert.equal(isMineMp4Key("users/abc/Videos/a.MP4"), true);
  assert.equal(isMineMp4Key("users/abc/Videos/a.mov"), false);
  assert.equal(suggestEditName("clip", "users/abc/Videos/Race Day.mp4"), "Race-Day-clip");
  assert.equal(suggestEditName("combine", "users/abc/Videos/Race.mp4"), "Race-combined");
  const body = combineRequest(["users/abc/Videos/a.mp4", "users/abc/Videos/b.mp4"], "Weekend");
  assert.equal(body.kind, "combine");
  assert.equal(body.sourceKeys.length, 2);
  assert.throws(() => combineRequest(["only-one.mp4"], "Weekend"), /at least two/);
});
