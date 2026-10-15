import { musicAlbumName } from "./privateFolders.js";

export function isFolderKey(key) {
  const k = String(key || "").replace(/^\/+/, "");
  return Boolean(k) && k.endsWith("/");
}

export function folderNameFromKey(key) {
  const parts = String(key || "").split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

export function parentPrefixOf(key) {
  const parts = String(key || "").split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `${parts.join("/")}/` : "";
}

export function listingReflectsRename(files, fromKey, nextKey, folders = []) {
  const keys = [...(files || []), ...(folders || [])].map((f) => f && f.key).filter(Boolean);
  return keys.includes(nextKey) && !keys.includes(fromKey);
}

export function followRenamedKey(key, aliases) {
  let k = String(key || "");
  const seen = new Set();
  while (aliases && aliases.has(k) && !seen.has(k)) {
    seen.add(k);
    k = aliases.get(k);
  }
  if (aliases && k === String(key || "")) {
    let bestFrom = "";
    let bestTo = "";
    for (const [from, to] of aliases) {
      if (from.endsWith("/") && k.startsWith(from) && from.length > bestFrom.length) {
        bestFrom = from;
        bestTo = to;
      }
    }
    if (bestFrom) k = `${bestTo}${k.slice(bestFrom.length)}`;
  }
  return k;
}

export function rememberRenamedKey(aliases, fromKey, nextKey) {
  for (const [from, to] of aliases) {
    if (to === fromKey) aliases.set(from, nextKey);
  }
  aliases.set(fromKey, nextKey);
  return aliases;
}

export function fileStemFromKey(key) {
  const name = String(key || "").split("/").pop() || folderNameFromKey(key);
  const stem = name.replace(/\.[^.]+$/, "");
  return stem || name;
}

export function jobMatchesRenameKey(job, fromKey) {
  const key = String(fromKey || "");
  if (!key) return false;
  if (key.endsWith("/")) {
    const prefix = String(job?.outputPrefix || "");
    if (prefix === key || prefix.startsWith(key) || (prefix && key.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))) {
      return prefix === key || prefix.startsWith(key);
    }
    const keys = Array.isArray(job?.outputKeys) ? job.outputKeys : [];
    return keys.some((item) => String(item).startsWith(key));
  }
  const name = key.split("/").pop() || "";
  const stem = name.replace(/\.[^.]+$/, "");
  const keys = Array.isArray(job?.outputKeys) ? job.outputKeys : [];
  if (keys.some((item) => item === key || String(item).split("/").pop() === name)) return true;
  const filename = String(job?.filename || "");
  const disc = String(job?.disc || "");
  return filename === name || filename === stem || disc === name || disc === stem;
}

export function videoJobTitle(job) {
  if (job?.renameDestKey) {
    const pending = String(job.renameDestKey);
    const album = musicAlbumName(pending) || (pending.endsWith("/") ? folderNameFromKey(pending) : "");
    if (album) return album;
    return fileStemFromKey(pending) || job?.filename || "video";
  }
  const album = musicAlbumName(job?.outputPrefix) || musicAlbumName((job?.outputKeys || [])[0] || "");
  if (album) return album;
  const keys = Array.isArray(job?.outputKeys) ? job.outputKeys.filter(Boolean) : [];
  if (keys.length) return fileStemFromKey(keys[0]) || job?.filename || "video";
  return job?.filename || "video";
}

export function displayNameForRenamedJob(filename, fromKey, nextKey) {
  const fromName = folderNameFromKey(fromKey) || String(fromKey || "").split("/").pop() || "";
  const nextName = folderNameFromKey(nextKey) || String(nextKey || "").split("/").pop() || "";
  const fromStem = fromName.replace(/\.[^.]+$/, "");
  const nextStem = nextName.replace(/\.[^.]+$/, "");
  if (filename === fromName || filename === fromStem) return nextStem || nextName;
  return filename;
}

export function destKeyForRename(fromKey, typedName) {
  const raw = String(fromKey || "").replace(/^\/+/, "");
  if (!raw) throw new Error("Choose a file to rename.");
  const folder = raw.endsWith("/");
  const key = folder ? raw : raw;
  const parts = key.split("/").filter(Boolean);
  if (!parts.length) throw new Error(folder ? "Choose a folder to rename." : "Choose a file to rename.");
  const oldName = parts.pop() || "";
  const oldExt = folder ? "" : extensionOfName(oldName);
  let name = String(typedName || "").split(/[/\\]/).pop() || "";
  name = name.replace(/[\u0000-\u001f]/g, "").trim();
  if (!name) throw new Error(folder ? "Enter a folder name." : "Enter a file name.");
  if (!folder && !extensionOfName(name) && oldExt) name = `${name}.${oldExt}`;
  name = name
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/ {2,}/g, " ")
    .replace(/^[.-]+|[.-]+$/g, "");
  if (!name) throw new Error(folder ? "Enter a folder name." : "Enter a file name.");
  name = name.slice(0, 180);
  const destKey = folder ? `${[...parts, name].join("/")}/` : [...parts, name].join("/");
  const fromNorm = folder ? (raw.endsWith("/") ? raw : `${raw}/`) : raw;
  return { fromKey: fromNorm, destKey, name, unchanged: destKey === fromNorm, folder };
}

function extensionOfName(name) {
  const base = String(name || "").split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  const ext = base.slice(dot + 1);
  return /^[A-Za-z0-9]{1,8}$/.test(ext) ? ext.toLowerCase() : "";
}
