// Optional per-deployment nav chrome from dliv_outputs.json → site.
// Missing or empty links leave #nav-out hidden.

export function siteLinks(config) {
  const raw = config?.site?.links;
  if (!Array.isArray(raw)) return [];
  const links = [];
  for (const item of raw) {
    const label = String(item?.label ?? "").trim();
    const href = String(item?.href ?? "").trim();
    if (!label || !isHttpUrl(href)) continue;
    links.push({ label, href });
  }
  return links;
}

export function pdfSearchDisplayLabel(config) {
  return String(config?.site?.pdfSearchLabel ?? "").trim() || "PDF Search";
}

export function applySiteChrome(config, doc = document) {
  const site = config?.site ?? {};
  const titleEl = doc.querySelector(".nav-title");
  if (titleEl) applyTitle(titleEl, site, doc);
  applyPdfSearchLabel(pdfSearchDisplayLabel(config), doc);

  const footer = String(site.footer ?? "").trim();
  const footerEl = doc.querySelector(".nav-bottom");
  if (footer && footerEl) footerEl.textContent = footer;

  const slot = doc.getElementById("nav-out");
  if (!slot) return siteLinks(config);
  slot.replaceChildren();
  const links = siteLinks(config);
  if (!links.length) {
    slot.hidden = true;
    return links;
  }
  slot.hidden = false;
  for (const link of links) {
    const a = doc.createElement("a");
    a.className = "nav-sub-item";
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = link.label;
    slot.append(a);
  }
  return links;
}

function applyPdfSearchLabel(label, doc) {
  if (typeof doc.querySelectorAll !== "function") return;
  doc.querySelectorAll("[data-pdf-search-label]").forEach((el) => {
    const tag = String(el.tagName || "").toUpperCase();
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") {
      el.setAttribute("aria-label", label);
      return;
    }
    el.textContent = label;
  });
}

function applyTitle(titleEl, site, doc) {
  const title = String(site.title ?? "").trim();
  const tagline = String(site.tagline ?? "").trim();
  if (!title && !tagline) return;
  if (title) titleEl.textContent = title;
  if (!tagline) return;
  let span = titleEl.querySelector("span");
  if (!span) {
    span = doc.createElement("span");
    titleEl.append(span);
  }
  span.textContent = tagline;
}

function isHttpUrl(href) {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
