import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIBRARY_FOLDER_NAMES,
  compareLibraryFolders,
  isReservedLibraryFolder,
  libraryAddMenuItems,
  libraryFileMenuItems,
  listingLibrary,
  mineLibraryKey,
  mineLibraryKeys,
  mineRootPrefix,
  showFileUploadButton,
  showFolderRenameButton,
  showLibraryAddMenu,
  showLibraryFileMenu,
  showStandaloneFolderButton,
  showVideoEditControls,
  showVideoUploadButton,
  showVideosAddMenu,
  showVideosFileMenu,
  videosFileMenuItems,
  musicDirectUploadError,
  jobMusicFolderLabel,
  jobMusicFolderPrefix,
} from "../frontend/privateFolders.js";

const sub = "11111111-2222-3333-4444-555555555555";

test("Mine gets Music, Photos, and Videos under the user prefix", () => {
  assert.deepEqual(mineLibraryKeys(sub), [
    `users/${sub}/Music/`,
    `users/${sub}/Photos/`,
    `users/${sub}/Videos/`,
  ]);
  assert.equal(LIBRARY_FOLDER_NAMES.length, 3);
});

test("shared Music/Photos/Videos stay reserved; other shared folders do not", () => {
  assert.equal(isReservedLibraryFolder("shared", "Videos/", sub), true);
  assert.equal(isReservedLibraryFolder("shared", "Photos/", sub), true);
  assert.equal(isReservedLibraryFolder("shared", "Music/", sub), true);
  assert.equal(isReservedLibraryFolder("shared", "Family/", sub), false);
});

test("Mine Music/Photos/Videos are reserved for that user only", () => {
  assert.equal(isReservedLibraryFolder("mine", `users/${sub}/Videos/`, sub), true);
  assert.equal(isReservedLibraryFolder("mine", `users/${sub}/Photos/`, sub), true);
  assert.equal(isReservedLibraryFolder("mine", `users/${sub}/Music/`, sub), true);
  assert.equal(isReservedLibraryFolder("mine", `users/${sub}/Notes/`, sub), false);
  assert.equal(isReservedLibraryFolder("mine", "users/other-user-id-xxxx/Videos/", sub), false);
  assert.equal(isReservedLibraryFolder("shared", `users/${sub}/Videos/`, sub), false);
  assert.equal(isReservedLibraryFolder("mine", "Videos/", sub), false);
});

test("Videos has Upload Video but not + File; Music and Photos have + File only", () => {
  const root = mineRootPrefix(sub);
  const videos = mineLibraryKey(sub, "Videos/");
  const photos = mineLibraryKey(sub, "Photos/");
  const music = mineLibraryKey(sub, "Music/");
  assert.equal(showFileUploadButton("mine", root, sub), false);
  assert.equal(showVideoUploadButton("mine", root, sub, true), false);
  assert.equal(showFileUploadButton("mine", videos, sub), false);
  assert.equal(showVideoUploadButton("mine", videos, sub, true), true);
  assert.equal(showFileUploadButton("mine", `${videos}clips/`, sub), false);
  assert.equal(showVideoUploadButton("mine", `${videos}clips/`, sub, true), true);
  assert.equal(showFileUploadButton("mine", photos, sub), true);
  assert.equal(showVideoUploadButton("mine", photos, sub, true), false);
  assert.equal(showFileUploadButton("mine", music, sub), true);
  assert.equal(showVideoUploadButton("mine", music, sub, true), false);
  assert.equal(showVideoUploadButton("video", root, sub, true), true);
  assert.equal(showFileUploadButton("shared", "", sub), true);
  assert.equal(showVideoUploadButton("shared", "Videos/", sub, true), false);
  assert.equal(showVideoEditControls("mine", videos, sub, true), true);
  assert.equal(showVideoEditControls("mine", `${videos}clips/`, sub, true), true);
  assert.equal(showVideoEditControls("mine", videos, sub, false), false);
  assert.equal(showVideoEditControls("video", videos, sub, true), false);
  assert.equal(showVideoEditControls("mine", photos, sub, true), false);
  assert.equal(showVideoEditControls("shared", "Videos/", sub, true), false);
  assert.equal(showVideosAddMenu("mine", videos, sub, true), true);
  assert.equal(showVideosAddMenu("mine", `${videos}clips/`, sub, true), true);
  assert.equal(showVideosAddMenu("mine", videos, sub, false), false);
  assert.equal(showVideosAddMenu("video", videos, sub, true), false);
  assert.equal(showStandaloneFolderButton("mine", videos, sub, true), false);
  assert.equal(showStandaloneFolderButton("mine", photos, sub, true), false);
  assert.equal(showVideosFileMenu("mine", videos, sub), true);
  assert.equal(showVideosFileMenu("mine", photos, sub), false);
  assert.deepEqual(videosFileMenuItems({ convertOn: true, isMp4: true, downloadMode: false, combineMode: false }), ["Clip", "Rename", "Combine", "Remove"]);
  assert.deepEqual(videosFileMenuItems({ convertOn: false, isMp4: true, downloadMode: false, combineMode: false }), ["Rename", "Remove"]);
  assert.deepEqual(videosFileMenuItems({ convertOn: true, isMp4: true, downloadMode: true, combineMode: false }), []);
});

test("Music and Photos use the Add menu and a hover file menu like Videos", () => {
  const videos = mineLibraryKey(sub, "Videos/");
  const photos = mineLibraryKey(sub, "Photos/");
  const music = mineLibraryKey(sub, "Music/");
  assert.equal(listingLibrary("mine", music, sub), "Music");
  assert.equal(listingLibrary("mine", `${photos}Barlieb/`, sub), "Photos");
  assert.equal(listingLibrary("shared", "Music/CD20261001-1/", sub), "Music");
  assert.equal(listingLibrary("mine", mineRootPrefix(sub), sub), "");
  assert.equal(showLibraryAddMenu("mine", music, sub, true), true);
  assert.equal(showLibraryAddMenu("mine", photos, sub, false), true);
  assert.equal(showLibraryAddMenu("shared", "Photos/Family/", sub, true), true);
  assert.equal(showLibraryAddMenu("mine", videos, sub, false), false);
  assert.deepEqual(libraryAddMenuItems("mine", music, sub, true).map((item) => item.label), ["Audio file", "Folder"]);
  assert.deepEqual(libraryAddMenuItems("mine", photos, sub, true).map((item) => item.label), ["Photo file", "Folder"]);
  assert.deepEqual(libraryAddMenuItems("mine", videos, sub, true).map((item) => item.label), [
    "Video file", "DVD files", "Audio files", "Folder",
  ]);
  assert.equal(showLibraryFileMenu("mine", music, sub), true);
  assert.equal(showLibraryFileMenu("mine", photos, sub), true);
  assert.equal(showLibraryFileMenu("shared", "Videos/", sub), true);
  assert.deepEqual(libraryFileMenuItems({
    library: "Music", convertOn: true, isMp4: false, downloadMode: false, combineMode: false, canEdit: false,
  }), ["Rename", "Remove"]);
  assert.deepEqual(libraryFileMenuItems({
    library: "Photos", convertOn: true, isMp4: false, downloadMode: false, combineMode: false, canEdit: false,
  }), ["Rename", "Remove"]);
  assert.equal(showStandaloneFolderButton("mine", music, sub, true), false);
  assert.equal(showStandaloneFolderButton("shared", "Music/", sub, true), false);
});

test("Music + File rejects anything that is not an mp3", () => {
  const music = mineLibraryKey(sub, "Music/");
  const videos = mineLibraryKey(sub, "Videos/");
  assert.equal(musicDirectUploadError("mine", music, sub, "01-Audio-Track.mp3"), "");
  assert.equal(musicDirectUploadError("mine", `${music}old/`, sub, "mix.MP3"), "");
  assert.match(musicDirectUploadError("mine", music, sub, "01 Audio Track.aiff"), /Use Convert Format/);
  assert.match(musicDirectUploadError("mine", music, sub, "song.wav"), /not an MP3/);
  assert.equal(musicDirectUploadError("mine", videos, sub, "clip.mov"), "");
  assert.equal(musicDirectUploadError("mine", mineLibraryKey(sub, "Photos/"), sub, "pic.jpg"), "");
});

test("audio jobs link to a dated Music album folder", () => {
  const album = `users/${sub}/Music/CD20261001-1/`;
  const job = {
    outputPrefix: album,
    outputKeys: [`${album}01-Audio-Track.mp3`],
  };
  assert.equal(jobMusicFolderPrefix(sub, job), album);
  assert.equal(jobMusicFolderLabel("Wenner2026", sub, job), "Wenner2026 → Music → CD20261001-1");
  assert.equal(
    jobMusicFolderLabel("Wenner2026", sub, { outputKeys: [`users/${sub}/Music/song.mp3`] }),
    "Wenner2026 → Music",
  );
});

test("Music and Photos album folders can be renamed; library roots cannot", () => {
  const music = mineLibraryKey(sub, "Music/");
  const photos = mineLibraryKey(sub, "Photos/");
  const videos = mineLibraryKey(sub, "Videos/");
  const album = `${music}CD20261001-1/`;
  assert.equal(showFolderRenameButton("mine", album, sub), true);
  assert.equal(showFolderRenameButton("mine", music, sub), false);
  assert.equal(showFolderRenameButton("mine", photos, sub), false);
  assert.equal(showFolderRenameButton("mine", `${photos}Barlieb RESZ/`, sub), true);
  assert.equal(showFolderRenameButton("mine", `${photos}GETZ pics/Barlieb/`, sub), true);
  assert.equal(showFolderRenameButton("shared", "Music/CD20261001-1/", sub), true);
  assert.equal(showFolderRenameButton("shared", "Photos/Family/", sub), true);
  assert.equal(showFolderRenameButton("shared", "Photos/", sub), false);
  assert.equal(showFolderRenameButton("mine", `${videos}clips/`, sub), false);
});

test("library folders sort first as Music, Photos, Videos", () => {
  const prefix = `users/${sub}/`;
  const keys = [
    `${prefix}Zoo/`,
    `${prefix}Videos/`,
    `${prefix}Notes/`,
    `${prefix}Music/`,
    `${prefix}Photos/`,
  ];
  keys.sort((a, b) => compareLibraryFolders(a, b, prefix));
  assert.deepEqual(keys, [
    `${prefix}Music/`,
    `${prefix}Photos/`,
    `${prefix}Videos/`,
    `${prefix}Notes/`,
    `${prefix}Zoo/`,
  ]);
});
