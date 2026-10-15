export const NEW_BOX_SELECT = "__new__";

export function folderOf(doc) {
  return ((doc && (doc.folder || doc.box)) || "ROOT").trim() || "ROOT";
}

export function resolvePdfUploadFolder(selected, typedName, existingFolders) {
  const folders = existingFolders || [];
  const sel = String(selected || "").trim();
  if (sel && sel !== NEW_BOX_SELECT) {
    if (!folders.includes(sel)) {
      throw new Error("That box is not in the list. Pick a box, or New box.");
    }
    return sel;
  }
  const name = String(typedName || "").trim();
  if (!name) {
    throw new Error("Name the box first.");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error("Box name can use letters, numbers, dots, and hyphens.");
  }
  return name;
}

export function compareArchiveName(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  const pa = /^BOX(\d+)(.*)$/i.exec(left);
  const pb = /^BOX(\d+)(.*)$/i.exec(right);
  if (pa && pb) {
    const diff = Number(pa[1]) - Number(pb[1]);
    if (diff) return diff;
    return pa[2].localeCompare(pb[2], undefined, { numeric: true, sensitivity: "base" });
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function compareCatalogTitle(a, b) {
  return String(a?.filename || "").localeCompare(String(b?.filename || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function groupedBoxes(docs) {
  const map = new Map();
  for (const d of docs || []) {
    const folder = folderOf(d);
    if (!map.has(folder)) map.set(folder, []);
    map.get(folder).push(d);
  }
  return [...map.entries()]
    .sort((a, b) => compareArchiveName(a[0], b[0]))
    .map(([folder, items]) => {
      const sorted = [...items].sort(compareCatalogTitle);
      const preview = sorted.find((d) => (d.description || "").trim())?.description || "";
      return { folder, docs: sorted, preview };
    });
}

export function parseSearchBoxes(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw || "").split(",");
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const name = String(part || "").trim();
    if (!name || seen.has(name)) continue;
    if (name.includes("..") || name.includes("/") || name.includes("\\")) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function filterHitsByFolders(hits, folders) {
  const want = new Set(parseSearchBoxes(folders));
  if (!want.size) return [...(hits || [])];
  return (hits || []).filter((h) => want.has(folderOf(h)));
}
