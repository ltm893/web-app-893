// Page ranges and the shareable print-page link for Ancestry extracts.

export function extractPageList(mode, from, to, count) {
  const total = Math.floor(Number(count));
  if (!Number.isFinite(total) || total < 1) {
    return { error: "This PDF has no pages." };
  }
  if (mode === "all") {
    return { pages: Array.from({ length: total }, (_, i) => i + 1) };
  }
  const start = Math.floor(Number(from));
  const end = Math.floor(Number(to));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1) {
    return { error: "Enter a page range." };
  }
  if (start > end) return { error: "The first page must come before the last page." };
  if (end > total) return { error: `This PDF has ${total} pages.` };
  const pages = [];
  for (let n = start; n <= end; n++) pages.push(n);
  return { pages };
}

function printItem(value) {
  if (typeof value === "string") {
    const url = value.trim();
    return url.startsWith("https://") ? { url, key: "" } : null;
  }
  const url = String(value?.url || "").trim();
  const key = String(value?.key || "").trim();
  if (!url.startsWith("https://")) return null;
  return { url, key };
}

export function extractPrintHref(imageUrls) {
  const items = (imageUrls || []).map(printItem).filter(Boolean);
  if (!items.length) return "";
  const payload = btoa(JSON.stringify(items))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `extract.html#${payload}`;
}

export function extractPrintUrl(imageUrls, base) {
  const href = extractPrintHref(imageUrls);
  if (!href || !base) return "";
  try {
    return new URL(href, base).href;
  } catch {
    return "";
  }
}

export function extractClipboardState(copied) {
  if (copied) return { label: "Copied", showUrl: false };
  return { label: "Clipboard", showUrl: true };
}

export function extractOverlayAction(overlayHidden) {
  return overlayHidden ? "open" : "extract";
}

export function extractKeysToRemove(keys, selectedKeys, { all = false } = {}) {
  const listed = [...new Set((keys || []).map((key) => String(key || "").trim()).filter(Boolean))];
  if (all) return listed;
  const picked = new Set((selectedKeys || []).map((key) => String(key || "").trim()).filter(Boolean));
  return listed.filter((key) => picked.has(key));
}

export function extractRemovePlan(items, signedIn) {
  const keys = (items || [])
    .map((item) => (typeof item === "string" ? "" : String(item?.key || "").trim()))
    .filter(Boolean);
  if (!keys.length) return { action: "list", keys: [] };
  if (!signedIn) return { action: "signin", keys };
  return { action: "delete", keys };
}

export function extractPrintItems(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw) return [];
  const b64 = raw.replaceAll("-", "+").replaceAll("_", "/");
  const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    const parsed = JSON.parse(atob(pad));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(printItem).filter(Boolean);
  } catch {
    return [];
  }
}

export function extractPrintUrls(hash) {
  return extractPrintItems(hash).map((item) => item.url);
}
