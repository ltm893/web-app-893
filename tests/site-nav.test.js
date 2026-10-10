import { test } from "node:test";
import assert from "node:assert/strict";
import { applySiteChrome, pdfSearchDisplayLabel, siteLinks } from "../frontend/siteNav.js";

const SCOUTY = "https://digital.fidelity.com/scouty";
const SLATE = "https://digital.fidelity.com/slate";

test("siteLinks keeps labeled http(s) urls and drops the rest", () => {
  const links = siteLinks({
    site: {
      links: [
        { label: "Scouty", href: SCOUTY },
        { label: "  Slate  ", href: SLATE },
        { label: "Skip", href: "javascript:alert(1)" },
        { label: "", href: "https://example.com" },
        { label: "Relative", href: "/sale.html" },
        { label: "Notes", href: "not a url" },
      ],
    },
  });
  assert.deepEqual(links, [
    { label: "Scouty", href: SCOUTY },
    { label: "Slate", href: SLATE },
  ]);
});

test("siteLinks is empty when site.links is missing", () => {
  assert.deepEqual(siteLinks({}), []);
  assert.deepEqual(siteLinks({ site: {} }), []);
  assert.deepEqual(siteLinks({ site: { links: "https://example.com" } }), []);
});

function stubDoc() {
  const title = node();
  title.childNodes = [node()];
  const footer = node();
  footer.textContent = "© 2020 DLIV";
  const slot = node();
  slot.hidden = true;
  const created = [];
  return {
    title,
    footer,
    slot,
    created,
    labels: [],
    querySelector(sel) {
      if (sel === ".nav-title") return title;
      if (sel === ".nav-bottom") return footer;
      return null;
    },
    querySelectorAll(sel) {
      return sel === "[data-pdf-search-label]" ? this.labels : [];
    },
    getElementById(id) {
      return id === "nav-out" ? slot : null;
    },
    createElement(tag) {
      const el = node();
      el.tag = tag;
      created.push(el);
      return el;
    },
  };
}

function node() {
  const el = {
    hidden: false,
    className: "",
    href: "",
    target: "",
    rel: "",
    childNodes: [],
    querySelector() {
      return this.childNodes.find((n) => n.tag === "span") ?? null;
    },
    replaceChildren(...kids) {
      this.childNodes = kids;
    },
    append(child) {
      this.childNodes.push(child);
    },
  };
  let text = "";
  Object.defineProperty(el, "textContent", {
    get() { return text; },
    set(value) {
      text = String(value);
      this.childNodes = [];
    },
  });
  return el;
}

test("pdf search label stays PDF Search unless the deployment renames it", () => {
  assert.equal(pdfSearchDisplayLabel({}), "PDF Search");
  assert.equal(pdfSearchDisplayLabel({ site: { pdfSearchLabel: "  Ancestry  " } }), "Ancestry");
  const doc = stubDoc();
  const label = node();
  doc.labels.push(label);
  applySiteChrome({ site: { pdfSearchLabel: "Ancestry", links: [] } }, doc);
  assert.equal(label.textContent, "Ancestry");
});

test("applySiteChrome hides the slot when there are no links", () => {
  const doc = stubDoc();
  applySiteChrome({ site: { links: [] } }, doc);
  assert.equal(doc.slot.hidden, true);
  assert.equal(doc.slot.childNodes.length, 0);
  assert.equal(doc.footer.textContent, "© 2020 DLIV");
});

test("applySiteChrome fills the slot and optional title", () => {
  const doc = stubDoc();
  applySiteChrome({
    site: {
      title: "DLIV",
      tagline: "Family & Friends",
      footer: "© 2026 DLIV",
      links: [{ label: "Scouty", href: SCOUTY }],
    },
  }, doc);
  assert.equal(doc.slot.hidden, false);
  assert.equal(doc.slot.childNodes.length, 1);
  const link = doc.slot.childNodes[0];
  assert.equal(link.href, SCOUTY);
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  assert.equal(link.textContent, "Scouty");
  assert.equal(doc.title.textContent, "DLIV");
  assert.equal(doc.title.querySelector("span").textContent, "Family & Friends");
  assert.equal(doc.footer.textContent, "© 2026 DLIV");
});
