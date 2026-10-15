const MAX_EDIT_SECONDS = 24 * 60 * 60;
const MAX_COMBINE = 20;

function badTime() {
  throw new Error("Use a time like 1:30 or 1:02:15.");
}

export function parseMediaTimestamp(raw) {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("Enter a start and end time.");
  if (text.startsWith("-")) throw new Error("That time is out of range.");
  let seconds;
  if (/^\d+(\.\d+)?$/.test(text)) {
    seconds = Number(text);
  } else {
    const parts = text.split(":");
    if (parts.length < 2 || parts.length > 3) badTime();
    const sec = parts[parts.length - 1];
    const heads = parts.slice(0, -1);
    if (!/^\d+(\.\d+)?$/.test(sec) || heads.some((part) => !/^\d+$/.test(part))) badTime();
    if (Number(sec) >= 60) badTime();
    if (parts.length === 3 && Number(parts[1]) >= 60) badTime();
    const nums = parts.map(Number);
    seconds = parts.length === 2 ? nums[0] * 60 + nums[1] : nums[0] * 3600 + nums[1] * 60 + nums[2];
  }
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_EDIT_SECONDS) {
    throw new Error("That time is out of range.");
  }
  return Math.round(seconds * 1000) / 1000;
}

export function formatMediaTimestamp(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0 || n > MAX_EDIT_SECONDS) {
    throw new Error("That time is out of range.");
  }
  const totalMs = Math.round(n * 1000);
  const ms = ((totalMs % 1000) + 1000) % 1000;
  const total = Math.floor(totalMs / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (part) => String(part).padStart(2, "0");
  const frac = ms ? `.${String(ms).padStart(3, "0").replace(/0+$/, "")}` : "";
  return `${h}:${pad(m)}:${pad(s)}${frac}`;
}

export function clipTimesFromMarks(startSeconds, endSeconds) {
  if (startSeconds == null || !Number.isFinite(Number(startSeconds))) {
    throw new Error("Mark the start of the clip.");
  }
  if (endSeconds == null || !Number.isFinite(Number(endSeconds))) {
    throw new Error("Mark the end of the clip.");
  }
  const start = formatMediaTimestamp(startSeconds);
  const end = formatMediaTimestamp(endSeconds);
  if (!(parseMediaTimestamp(end) > parseMediaTimestamp(start))) {
    throw new Error("End time has to be after the start time.");
  }
  return { start, end };
}

export function isMineMp4Key(key) {
  return /\.(mp4|m4v)$/i.test(String(key || "").split(/[?#]/)[0]);
}

export function suggestEditName(kind, sourceKey) {
  const base = String(sourceKey || "").split("/").pop().replace(/\.(mp4|m4v)$/i, "") || "video";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "video";
  return kind === "combine" ? `${cleaned}-combined` : `${cleaned}-clip`;
}

export function clipRequest(sourceKey, start, end, name) {
  const startAt = parseMediaTimestamp(start);
  const endAt = parseMediaTimestamp(end);
  if (!(endAt > startAt)) throw new Error("End time has to be after the start time.");
  const filename = String(name || "").trim();
  if (!filename) throw new Error("Enter a file name.");
  return {
    kind: "clip",
    sourceKey: String(sourceKey || ""),
    start: String(start).trim(),
    end: String(end).trim(),
    name: filename,
  };
}

export function combineRequest(sourceKeys, name) {
  const keys = Array.isArray(sourceKeys) ? sourceKeys.filter(Boolean) : [];
  if (keys.length < 2) throw new Error("Choose at least two MP4s.");
  if (keys.length > MAX_COMBINE) throw new Error("Combine up to 20 MP4s.");
  const filename = String(name || "").trim();
  if (!filename) throw new Error("Enter a file name.");
  return { kind: "combine", sourceKeys: keys, name: filename };
}
