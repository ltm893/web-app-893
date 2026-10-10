import { test } from "node:test";
import assert from "node:assert/strict";
import {
  destKeyForRename,
  displayNameForRenamedJob,
  followRenamedKey,
  jobMatchesRenameKey,
  listingReflectsRename,
  rememberRenamedKey,
  videoJobTitle,
} from "../frontend/privateRename.js";

test("keeps the folder and adds .mp4 when the new name has no extension", () => {
  const sub = "11111111-2222-3333-4444-555555555555";
  const out = destKeyForRename(`users/${sub}/Videos/DVD-copy.mp4`, "CampingDragRacing");
  assert.equal(out.destKey, `users/${sub}/Videos/CampingDragRacing.mp4`);
  assert.equal(out.unchanged, false);
  assert.equal(out.folder, false);
});

test("renames a Music CD folder in place and keeps the trailing slash", () => {
  const sub = "11111111-2222-3333-4444-555555555555";
  const out = destKeyForRename(`users/${sub}/Music/CD20261001-1/`, "1973 Rupert Held Phone");
  assert.equal(out.destKey, `users/${sub}/Music/1973 Rupert Held Phone/`);
  assert.equal(out.name, "1973 Rupert Held Phone");
  assert.equal(out.folder, true);
  assert.equal(out.unchanged, false);
});

test("renames a nested Photos folder in place and keeps the trailing slash", () => {
  const sub = "11111111-2222-3333-4444-555555555555";
  const out = destKeyForRename(`users/${sub}/Photos/GETZ pics/Barlieb/`, "Barlieb farm");
  assert.equal(out.destKey, `users/${sub}/Photos/GETZ pics/Barlieb farm/`);
  assert.equal(out.folder, true);
});

test("rejects empty names", () => {
  assert.throws(() => destKeyForRename("users/x/Videos/a.mp4", "   "), /Enter a file name/);
  assert.throws(() => destKeyForRename("users/x/Music/CD20261001-1/", "   "), /Enter a folder name/);
});

test("listingReflectsRename waits until the old key is gone and the new key is present", () => {
  const fromKey = "users/x/Videos/DVD-copy.mp4";
  const nextKey = "users/x/Videos/Camping.mp4";
  assert.equal(listingReflectsRename([{ key: fromKey }], fromKey, nextKey), false);
  assert.equal(listingReflectsRename([{ key: fromKey }, { key: nextKey }], fromKey, nextKey), false);
  assert.equal(listingReflectsRename([{ key: nextKey }], fromKey, nextKey), true);
  const fromFolder = "users/x/Music/CD20261001-1/";
  const nextFolder = "users/x/Music/TomHeld/";
  assert.equal(listingReflectsRename([], fromFolder, nextFolder, [{ key: nextFolder }]), true);
});

test("renamed output keys survive a later job poll that still has the old S3 key", () => {
  const aliases = new Map();
  const fromKey = "users/x/Videos/DVD-copy.mp4";
  const nextKey = "users/x/Videos/Camping.mp4";
  rememberRenamedKey(aliases, fromKey, nextKey);
  assert.equal(followRenamedKey(fromKey, aliases), nextKey);
  rememberRenamedKey(aliases, nextKey, "users/x/Videos/Race.mp4");
  assert.equal(followRenamedKey(fromKey, aliases), "users/x/Videos/Race.mp4");
  assert.equal(displayNameForRenamedJob("DVD-copy", fromKey, nextKey), "Camping");
});

test("the original upload name stays on the job when only the mp4 key changes", () => {
  const aliases = new Map();
  const fromKey = "users/x/Videos/TrentonHS.mp4";
  const nextKey = "users/x/Videos/Camping.mp4";
  rememberRenamedKey(aliases, fromKey, nextKey);
  const job = { filename: "TrentonHS", outputKeys: [fromKey] };
  const outputKeys = job.outputKeys.map((key) => followRenamedKey(key, aliases));
  assert.deepEqual(outputKeys, [nextKey]);
  assert.equal(job.filename, "TrentonHS");
  assert.equal(videoJobTitle({ ...job, outputKeys }), "Camping");
});

test("Video Conversions title follows the mp4 name and a pending rename", () => {
  const fromKey = "users/x/Videos/Wenner02.mp4";
  const destKey = "users/x/Videos/FamilyTrip.mp4";
  assert.equal(videoJobTitle({ filename: "Wenner02", outputKeys: [fromKey] }), "Wenner02");
  assert.equal(videoJobTitle({ filename: "Wenner02", outputKeys: [fromKey], renameDestKey: destKey }), "FamilyTrip");
  assert.equal(jobMatchesRenameKey({ filename: "Wenner02", outputKeys: [fromKey] }, fromKey), true);
  assert.equal(jobMatchesRenameKey({ filename: "Wenner02", outputKeys: [] }, fromKey), true);
});

test("audio conversions use the CD folder name, including a pending album rename", () => {
  const fromPrefix = "users/x/Music/CD20261001-1/";
  const destPrefix = "users/x/Music/1973-Rupert-Held-Phone/";
  assert.equal(
    videoJobTitle({
      filename: "01-Audio-Track",
      outputPrefix: fromPrefix,
      outputKeys: [`${fromPrefix}01-Audio-Track.mp3`],
    }),
    "CD20261001-1",
  );
  assert.equal(
    videoJobTitle({
      filename: "01-Audio-Track",
      outputPrefix: fromPrefix,
      outputKeys: [`${fromPrefix}01-Audio-Track.mp3`],
      renameDestKey: destPrefix,
    }),
    "1973-Rupert-Held-Phone",
  );
  assert.equal(jobMatchesRenameKey({ outputPrefix: fromPrefix, outputKeys: [`${fromPrefix}01-Audio-Track.mp3`] }, fromPrefix), true);
});
