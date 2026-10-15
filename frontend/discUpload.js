const DISC_LAYOUT_DIRS = new Set(["video_ts", "video_rm"]);
const KEEP_ROOT_DIRS = new Set(["video_ts", "video_rm", "audio_ts"]);
const DISC_EXTS = new Set([
  "vob", "ifo", "bup", "dat", "vro", "mpg", "mpeg", "mp4", "m4v", "mov", "avi", "mkv", "wmv", "m2ts", "mts",
]);
const AUDIO_EXTS = new Set(["aiff", "aif", "wav", "flac", "m4a", "aac", "ogg", "wma", "mp3"]);

function extensionOf(name) {
  const base = String(name || "").split(/[/\\]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function isJunkDiscPath(rel) {
  const path = String(rel || "").replace(/\\/g, "/");
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return true;
  return parts.some((part) => (
    part === ".DS_Store"
    || part.startsWith("._")
    || part === ".Trash"
    || part === ".Trashes"
    || part === ".Spotlight-V100"
    || part === ".fseventsd"
    || part === "ready"
  ));
}

export function looksLikeDisc(relativePaths) {
  const paths = relativePaths.map((p) => String(p || "").replace(/\\/g, "/").toLowerCase());
  return paths.some((p) => p.split("/").some((part) => DISC_LAYOUT_DIRS.has(part)));
}

export function looksLikeAudio(relativePaths) {
  const paths = relativePaths.map((p) => String(p || "").replace(/\\/g, "/").toLowerCase());
  return paths.some((p) => AUDIO_EXTS.has(extensionOf(p)));
}

export function stripCommonDiscRoot(relativePaths) {
  const paths = relativePaths.map((p) => String(p || "").replace(/\\/g, "/").replace(/^\/+/, ""));
  if (paths.length < 1) return paths;
  const firstParts = paths.map((p) => p.split("/").filter(Boolean)[0] || "");
  const root = firstParts[0];
  if (!root || firstParts.some((part) => part !== root)) return paths;
  if (KEEP_ROOT_DIRS.has(root.toLowerCase())) return paths;
  return paths.map((p) => p.split("/").filter(Boolean).slice(1).join("/")).filter(Boolean);
}

export function snapshotFileList(fileList) {
  return [...(fileList || [])];
}

export function collectDiscFiles(fileList) {
  const incoming = snapshotFileList(fileList).filter((f) => f && Number(f.size) > 0);
  const kept = [];
  for (const file of incoming) {
    const rel = String(file.webkitRelativePath || file.name || "").replace(/\\/g, "/");
    if (isJunkDiscPath(rel)) continue;
    if (rel.split("/").some((part) => part.toLowerCase() === "audio_ts")) continue;
    if (!DISC_EXTS.has(extensionOf(rel))) continue;
    kept.push({ file, rel });
  }
  if (!kept.length) {
    throw new Error("That folder has no DVD files to convert.");
  }
  const stripped = stripCommonDiscRoot(kept.map((row) => row.rel));
  if (!looksLikeDisc(stripped)) {
    throw new Error("Choose a DVD folder that contains VIDEO_TS or VIDEO_RM.");
  }
  const files = kept.map((row, i) => ({
    file: row.file,
    relativePath: stripped[i],
  })).filter((row) => row.relativePath);
  const wrapper = kept[0].rel.split("/").filter(Boolean)[0] || "";
  const name = KEEP_ROOT_DIRS.has(wrapper.toLowerCase()) ? "disc" : wrapper;
  return { name: name || "disc", files, kind: "disc" };
}

export function collectAudioFiles(fileList) {
  const incoming = snapshotFileList(fileList).filter((f) => f && Number(f.size) > 0);
  const kept = [];
  for (const file of incoming) {
    const rel = String(file.webkitRelativePath || file.name || "").replace(/\\/g, "/");
    if (isJunkDiscPath(rel)) continue;
    if (!AUDIO_EXTS.has(extensionOf(rel))) continue;
    kept.push({ file, rel });
  }
  if (!kept.length) {
    throw new Error("That folder has no audio files to convert.");
  }
  const stripped = stripCommonDiscRoot(kept.map((row) => row.rel));
  if (!looksLikeAudio(stripped)) {
    throw new Error("Choose a folder of AIFF, WAV, FLAC, M4A, or MP3 files.");
  }
  const files = kept.map((row, i) => ({
    file: row.file,
    relativePath: stripped[i],
  })).filter((row) => row.relativePath);
  const wrapper = kept[0].rel.split("/").filter(Boolean)[0] || "";
  const name = KEEP_ROOT_DIRS.has(wrapper.toLowerCase()) ? "audio" : wrapper;
  return { name: name || "audio", files, kind: "audio" };
}

export function collectConvertFolder(fileList) {
  const incoming = snapshotFileList(fileList);
  const rels = incoming.map((f) => String(f?.webkitRelativePath || f?.name || ""));
  if (looksLikeDisc(rels)) return collectDiscFiles(fileList);
  if (looksLikeAudio(rels)) return collectAudioFiles(fileList);
  throw new Error("Choose a DVD folder (VIDEO_TS) or a folder of audio files.");
}
