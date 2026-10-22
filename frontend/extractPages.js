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

export function extractPageCountStatus(currentStatus, mode, from, to, total) {
  const status = String(currentStatus || "");
  if (!/^This PDF has \d+ pages\.$/.test(status)) return status;
  const choice = extractPageList(mode, from, to, total);
  if (choice.error && /^This PDF has \d+ pages\.$/.test(choice.error)) return choice.error;
  return "";
}

export function extractButtonLabel(open) {
  return open ? "Save Extract" : "Extract";
}

export function extractPanelOpenAfterSave(savedCount) {
  return !(Number(savedCount) > 0);
}

export function nextExtractRange(from, to, page) {
  const start = String(from ?? "");
  const end = String(to ?? "");
  if (start && end && start !== end) return { from: start, to: end };
  const n = Math.floor(Number(page));
  if (!Number.isFinite(n) || n < 1) return { from: start || "1", to: end || start || "1" };
  return { from: String(n), to: String(n) };
}

export function keptExtractItems(previousItems, savedItems) {
  if (savedItems?.length) return savedItems;
  return previousItems || [];
}

export function extractStampFromKey(key) {
  const match = /-p\d+-(\d{8}T\d{6}Z)\./i.exec(String(key || ""));
  return match ? match[1].toUpperCase() : "";
}

export function formatExtractPageLabel(pages) {
  const nums = [...new Set((pages || []).map((n) => Math.floor(Number(n))).filter((n) => n >= 1))].sort((a, b) => a - b);
  if (!nums.length) return "";
  const runs = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === prev + 1) {
      prev = nums[i];
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = nums[i];
  }
  runs.push(start === prev ? `${start}` : `${start}–${prev}`);
  return `p. ${runs.join(", ")}`;
}

export function groupExtractRanges(extracts, gapMs = 3 * 60 * 1000) {
  const items = (extracts || []).map((item) => ({
    key: String(item?.key || ""),
    folder: String(item?.folder || ""),
    filename: String(item?.filename || ""),
    page: Math.floor(Number(item?.page)),
    createdAt: String(item?.createdAt || ""),
    stamp: String(item?.stamp || extractStampFromKey(item?.key)),
  })).filter((item) => item.key && item.page >= 1);
  items.sort((a, b) => {
    const doc = `${a.folder}/${a.filename}`.localeCompare(`${b.folder}/${b.filename}`);
    if (doc) return doc;
    const time = a.createdAt.localeCompare(b.createdAt);
    if (time) return time;
    return a.page - b.page;
  });
  const groups = [];
  for (const item of items) {
    const prev = groups[groups.length - 1];
    const last = prev?.items[prev.items.length - 1];
    const sameDoc = last && last.folder === item.folder && last.filename === item.filename;
    const sameStamp = Boolean(sameDoc && item.stamp && last.stamp === item.stamp);
    const prevMs = Date.parse(last?.createdAt || "");
    const nextMs = Date.parse(item.createdAt || "");
    const continues = Boolean(
      sameDoc
      && item.page === last.page + 1
      && Number.isFinite(prevMs)
      && Number.isFinite(nextMs)
      && nextMs >= prevMs
      && nextMs - prevMs <= gapMs
    );
    if (prev && (sameStamp || continues)) {
      prev.items.push(item);
      continue;
    }
    groups.push({ items: [item] });
  }
  return groups.map((group) => {
    const ordered = [...group.items].sort((a, b) => a.page - b.page || a.key.localeCompare(b.key));
    const pages = ordered.map((item) => item.page);
    const createdAt = ordered.map((item) => item.createdAt).filter(Boolean).sort().at(-1) || "";
    return {
      keys: ordered.map((item) => item.key),
      folder: ordered[0].folder,
      filename: ordered[0].filename,
      pages,
      label: formatExtractPageLabel(pages),
      createdAt,
    };
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
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
