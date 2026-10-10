import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APP_TAB_TITLE,
  isPlayableAudioKey,
  isPlayableVideoKey,
  keepAppTabTitle,
  skipMediaTime,
  VIDEO_NUDGE_SECONDS,
  VIDEO_SKIP_SECONDS,
  formatMediaLength,
  formatFileSize,
} from "../frontend/mediaPlay.js";

test("mp3 and mp4 play on the DLIV page instead of opening S3", () => {
  assert.equal(isPlayableAudioKey("users/x/Music/03-Audio-Track.mp3"), true);
  assert.equal(isPlayableAudioKey("users/x/Music/03-Audio-Track.MP3"), true);
  assert.equal(isPlayableAudioKey("users/x/Videos/clip.mp4"), false);
  assert.equal(isPlayableVideoKey("users/x/Videos/FlorenceAt4509.mp4"), true);
  assert.equal(isPlayableVideoKey("users/x/Videos/clip.MOV"), true);
  assert.equal(isPlayableVideoKey("users/x/Music/03-Audio-Track.mp3"), false);
  assert.equal(isPlayableAudioKey("notes.pdf"), false);
});

test("keepAppTabTitle stays DLIV", () => {
  assert.equal(APP_TAB_TITLE, "DLIV");
  globalThis.document = { title: "dliv-private-files.s3.us-east-1.amazonaws.com" };
  keepAppTabTitle();
  assert.equal(globalThis.document.title, "DLIV");
  delete globalThis.document;
});

test("video skip moves ten seconds and stays in range", () => {
  assert.equal(VIDEO_SKIP_SECONDS, 10);
  assert.equal(skipMediaTime(2.5, 90, VIDEO_SKIP_SECONDS), 12.5);
  assert.equal(skipMediaTime(8, 90, -VIDEO_SKIP_SECONDS), 0);
  assert.equal(skipMediaTime(85, 90, VIDEO_SKIP_SECONDS), 90);
  assert.equal(skipMediaTime(12, Number.NaN, -VIDEO_SKIP_SECONDS), 2);
});

test("video nudge moves half a second", () => {
  assert.equal(VIDEO_NUDGE_SECONDS, 0.5);
  assert.equal(skipMediaTime(2.5, 90, VIDEO_NUDGE_SECONDS), 3);
  assert.equal(skipMediaTime(0.2, 90, -VIDEO_NUDGE_SECONDS), 0);
});

test("file size stays on one line and length uses clock time", () => {
  assert.equal(formatFileSize(47 * 1024 * 1024), "47.0 MB");
  assert.equal(formatFileSize(2202.9 * 1024 * 1024), "2.2 GB");
  assert.equal(formatMediaLength(47), "0:47");
  assert.equal(formatMediaLength(90), "1:30");
  assert.equal(formatMediaLength(4511), "1:15:11");
});
