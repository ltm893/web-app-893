export const APP_TAB_TITLE = "DLIV";

const AUDIO_EXTS = new Set(["mp3"]);
const VIDEO_EXTS = new Set(["mp4", "m4v", "mov", "webm"]);

function fileNameOf(key) {
  return String(key || "").split(/[?#]/)[0].split("/").pop() || "";
}

function extensionOf(key) {
  const name = fileNameOf(key);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isPlayableAudioKey(key) {
  return AUDIO_EXTS.has(extensionOf(key));
}

export function isPlayableVideoKey(key) {
  return VIDEO_EXTS.has(extensionOf(key));
}

export const VIDEO_SKIP_SECONDS = 10;
export const VIDEO_NUDGE_SECONDS = 0.5;

export function skipMediaTime(current, duration, delta) {
  const at = Number(current);
  if (!Number.isFinite(at)) return 0;
  const next = at + Number(delta);
  if (!Number.isFinite(next)) return Math.max(0, at);
  const max = Number(duration);
  const end = Number.isFinite(max) && max > 0 ? max : Number.POSITIVE_INFINITY;
  return Math.min(end, Math.max(0, next));
}

export function formatMediaLength(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return "";
  const total = Math.round(n);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (part) => String(part).padStart(2, "0");
  if (h) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function keepAppTabTitle() {
  if (typeof document === "undefined") return;
  if (document.title !== APP_TAB_TITLE) document.title = APP_TAB_TITLE;
}
