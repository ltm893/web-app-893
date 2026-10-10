import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectConvertFolder,
  collectDiscFiles,
  looksLikeDisc,
  snapshotFileList,
  stripCommonDiscRoot,
} from "../frontend/discUpload.js";

test("snapshotFileList copies entries before a live list is cleared", () => {
  const live = {
    0: { name: "VTS_01_1.VOB", size: 2_000_000 },
    1: { name: "VIDEO_TS.IFO", size: 12_000 },
    length: 2,
    *[Symbol.iterator]() {
      for (let i = 0; i < this.length; i++) yield this[i];
    },
  };
  const copied = snapshotFileList(live);
  live.length = 0;
  assert.equal(copied.length, 2);
  assert.equal(copied[0].name, "VTS_01_1.VOB");
});

test("strips the volume name so VIDEO_TS stays at the ingest root", () => {
  assert.deepEqual(stripCommonDiscRoot([
    "DVD Video Recording/VIDEO_TS/VTS_01_1.VOB",
    "DVD Video Recording/VIDEO_RM/VIDEO_RM.DAT",
  ]), [
    "VIDEO_TS/VTS_01_1.VOB",
    "VIDEO_RM/VIDEO_RM.DAT",
  ]);
});

test("keeps VIDEO_TS when that folder was chosen directly", () => {
  assert.deepEqual(stripCommonDiscRoot([
    "VIDEO_TS/VTS_01_1.VOB",
    "VIDEO_TS/VIDEO_TS.IFO",
  ]), [
    "VIDEO_TS/VTS_01_1.VOB",
    "VIDEO_TS/VIDEO_TS.IFO",
  ]);
});

test("collectDiscFiles rejects a random photo folder", () => {
  assert.throws(
    () => collectDiscFiles([{ name: "pic.jpg", webkitRelativePath: "Holiday/pic.jpg", size: 100 }]),
    /no DVD files/,
  );
});

test("collectDiscFiles rejects loose video files that are not a DVD layout", () => {
  assert.throws(
    () => collectDiscFiles([{ name: "clip.mp4", webkitRelativePath: "Holiday/clip.mp4", size: 2_000_000 }]),
    /VIDEO_TS or VIDEO_RM/,
  );
});

test("collectDiscFiles keeps VIDEO_TS when that folder was chosen directly", () => {
  const out = collectDiscFiles([
    { name: "VTS_01_1.VOB", webkitRelativePath: "VIDEO_TS/VTS_01_1.VOB", size: 2_000_000 },
    { name: "VIDEO_TS.IFO", webkitRelativePath: "VIDEO_TS/VIDEO_TS.IFO", size: 12_000 },
  ]);
  assert.equal(out.name, "disc");
  assert.deepEqual(out.files.map((f) => f.relativePath), [
    "VIDEO_TS/VTS_01_1.VOB",
    "VIDEO_TS/VIDEO_TS.IFO",
  ]);
});

test("collectDiscFiles keeps VOB and DAT files from a mounted disc", () => {
  const out = collectDiscFiles([
    { name: ".DS_Store", webkitRelativePath: "DVD Video Recording/.DS_Store", size: 12 },
    { name: "VTS_01_1.VOB", webkitRelativePath: "DVD Video Recording/VIDEO_TS/VTS_01_1.VOB", size: 2_000_000 },
    { name: "VIDEO_RM.DAT", webkitRelativePath: "DVD Video Recording/VIDEO_RM/VIDEO_RM.DAT", size: 2_000_000 },
  ]);
  assert.equal(out.name, "DVD Video Recording");
  assert.deepEqual(out.files.map((f) => f.relativePath), [
    "VIDEO_TS/VTS_01_1.VOB",
    "VIDEO_RM/VIDEO_RM.DAT",
  ]);
  assert.equal(looksLikeDisc(out.files.map((f) => f.relativePath)), true);
});

test("collectConvertFolder accepts a folder of AIFF tracks", () => {
  const out = collectConvertFolder([
    { name: "01 Audio Track.aiff", webkitRelativePath: "TomHeldAudio/01 Audio Track.aiff", size: 1_400_000 },
    { name: "02 Audio Track.aiff", webkitRelativePath: "TomHeldAudio/02 Audio Track.aiff", size: 9_000_000 },
  ]);
  assert.equal(out.kind, "audio");
  assert.equal(out.name, "TomHeldAudio");
  assert.deepEqual(out.files.map((f) => f.relativePath), [
    "01 Audio Track.aiff",
    "02 Audio Track.aiff",
  ]);
});
