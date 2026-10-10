// Shared library folders at Dropbox root and the same names under Mine.

export const LIBRARY_FOLDER_NAMES = ["Music/", "Photos/", "Videos/"];

export function mineRootPrefix(userId) {
  return userId ? `users/${userId}/` : "";
}

export function mineLibraryKey(userId, name) {
  return `${mineRootPrefix(userId)}${name}`;
}

export function mineLibraryKeys(userId) {
  return LIBRARY_FOLDER_NAMES.map((name) => mineLibraryKey(userId, name));
}

export function isReservedLibraryFolder(tab, folderKey, userId) {
  const key = String(folderKey || "").endsWith("/") ? folderKey : `${folderKey || ""}/`;
  if (tab === "shared") return LIBRARY_FOLDER_NAMES.includes(key);
  if (tab === "mine" && userId) {
    const root = mineRootPrefix(userId);
    if (!key.startsWith(root)) return false;
    return LIBRARY_FOLDER_NAMES.includes(key.slice(root.length));
  }
  return false;
}

export function isUnderMineLibrary(tab, prefix, userId, name) {
  if (tab !== "mine" || !userId) return false;
  const root = mineLibraryKey(userId, name);
  const current = String(prefix || "");
  return current === root || current.startsWith(root);
}

export function isUnderSharedLibrary(prefix, name) {
  const current = String(prefix || "");
  return current === name || current.startsWith(name);
}

export function listingLibrary(tab, prefix, userId) {
  for (const name of LIBRARY_FOLDER_NAMES) {
    const label = name.slice(0, -1);
    if (isUnderMineLibrary(tab, prefix, userId, name)) return label;
    if (tab === "shared" && isUnderSharedLibrary(prefix, name)) return label;
  }
  return "";
}

export function isMineRootListing(tab, prefix, userId) {
  if (tab !== "mine" || !userId) return false;
  const root = mineRootPrefix(userId);
  return !prefix || prefix === root;
}

export function showFileUploadButton(tab, prefix, userId) {
  if (isMineRootListing(tab, prefix, userId)) return false;
  if (isUnderMineLibrary(tab, prefix, userId, "Videos/")) return false;
  return true;
}

export function showVideoUploadButton(tab, prefix, userId, videoConvertOn) {
  if (!videoConvertOn) return false;
  if (tab === "video") return true;
  return isUnderMineLibrary(tab, prefix, userId, "Videos/");
}

export function showVideoEditControls(tab, prefix, userId, videoConvertOn) {
  return tab === "mine" && showVideoUploadButton(tab, prefix, userId, videoConvertOn);
}

export function showVideosAddMenu(tab, prefix, userId, videoConvertOn) {
  return listingLibrary(tab, prefix, userId) === "Videos" && tab === "mine" && !!videoConvertOn;
}

export function showLibraryAddMenu(tab, prefix, userId, videoConvertOn) {
  const library = listingLibrary(tab, prefix, userId);
  if (library === "Videos") return showVideosAddMenu(tab, prefix, userId, videoConvertOn);
  return library === "Music" || library === "Photos";
}

export function libraryAddMenuItems(tab, prefix, userId, videoConvertOn) {
  if (!showLibraryAddMenu(tab, prefix, userId, videoConvertOn)) return [];
  const library = listingLibrary(tab, prefix, userId);
  if (library === "Videos") {
    return [
      { label: "Video file", action: "video" },
      { label: "DVD files", action: "disc" },
      { label: "Audio files", action: "disc" },
      { label: "Folder", action: "folder" },
    ];
  }
  if (library === "Music") {
    return [
      { label: "Audio file", action: "file" },
      { label: "Folder", action: "folder" },
    ];
  }
  if (library === "Photos") {
    return [
      { label: "Photo file", action: "file" },
      { label: "Folder", action: "folder" },
    ];
  }
  return [];
}

export function showVideosFileMenu(tab, prefix, userId) {
  return listingLibrary(tab, prefix, userId) === "Videos" && tab === "mine";
}

export function showLibraryFileMenu(tab, prefix, userId) {
  return listingLibrary(tab, prefix, userId) !== "";
}

export function showStandaloneFolderButton(tab, prefix, userId, videoConvertOn) {
  return !showLibraryAddMenu(tab, prefix, userId, videoConvertOn);
}

export function videosFileMenuItems({ convertOn, isMp4, downloadMode, combineMode }) {
  return libraryFileMenuItems({
    library: "Videos",
    convertOn,
    isMp4,
    downloadMode,
    combineMode,
    canEdit: true,
  });
}

export function libraryFileMenuItems({ library, convertOn, isMp4, downloadMode, combineMode, canEdit }) {
  if (downloadMode || combineMode) return [];
  if (!library) return [];
  const items = ["Rename"];
  if (canEdit && convertOn && isMp4) {
    items.unshift("Clip");
    items.push("Combine");
  }
  items.push("Remove");
  return items;
}

export function musicAlbumName(prefixOrKey) {
  const parts = String(prefixOrKey || "").split("/").filter(Boolean);
  const musicAt = parts.lastIndexOf("Music");
  if (musicAt < 0) return "";
  const next = parts[musicAt + 1] || "";
  if (!next || /\.[a-z0-9]+$/i.test(next)) return "";
  return next;
}

export function jobMusicFolderPrefix(userId, job) {
  const root = mineLibraryKey(userId, "Music/");
  const prefix = String(job?.outputPrefix || "");
  if (userId && prefix.startsWith(root)) {
    return prefix.endsWith("/") ? prefix : `${prefix}/`;
  }
  const keys = Array.isArray(job?.outputKeys) ? job.outputKeys : [];
  for (const key of keys) {
    if (!userId || !String(key).startsWith(root)) continue;
    const album = musicAlbumName(key);
    return album ? `${root}${album}/` : root;
  }
  return root;
}

export function jobMusicFolderLabel(who, userId, job) {
  const album = musicAlbumName(jobMusicFolderPrefix(userId, job));
  const base = `${who} → Music`;
  return album ? `${base} → ${album}` : base;
}

const RENAMEABLE_LIBRARY_FOLDERS = ["Music/", "Photos/"];

export function showFolderRenameButton(tab, folderKey, userId) {
  const key = String(folderKey || "").endsWith("/") ? String(folderKey) : `${folderKey || ""}/`;
  if (!key || isReservedLibraryFolder(tab, key, userId)) return false;
  return RENAMEABLE_LIBRARY_FOLDERS.some((name) => {
    if (tab === "mine" && userId) {
      const root = mineLibraryKey(userId, name);
      return key.startsWith(root) && key !== root;
    }
    if (tab === "shared") return key.startsWith(name) && key !== name;
    return false;
  });
}

export function musicDirectUploadError(tab, prefix, userId, filename) {
  if (!isUnderMineLibrary(tab, prefix, userId, "Music/")) return "";
  const base = String(filename || "").split(/[/\\]/).pop() || "";
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
  if (ext === "mp3") return "";
  return `"${base || "This file"}" is not an MP3. Use Convert Format.`;
}

export function compareLibraryFolders(aKey, bKey, prefix) {
  const root = prefix || "";
  const a = String(aKey || "").startsWith(root) ? aKey.slice(root.length) : aKey;
  const b = String(bKey || "").startsWith(root) ? bKey.slice(root.length) : bKey;
  const ai = LIBRARY_FOLDER_NAMES.indexOf(a);
  const bi = LIBRARY_FOLDER_NAMES.indexOf(b);
  if (ai >= 0 && bi >= 0) return ai - bi;
  if (ai >= 0) return -1;
  if (bi >= 0) return 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}
