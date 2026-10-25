import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  extractButtonLabel,
  extractPanelOpenAfterSave,
  formatExtractPageLabel,
  groupExtractRanges,
  extractClipboardState,
  extractKeysToRemove,
  extractOverlayAction,
  extractPageCountStatus,
  extractPageList,
  extractPrintHref,
  extractPrintItems,
  extractPrintUrl,
  extractPrintUrls,
  extractRemovePlan,
  keptExtractItems,
  nextExtractRange,
} from "../frontend/extractPages.js";
test("Clipboard copies the share URL and hides it", () => {
  const copied = extractClipboardState(true);
  const refused = extractClipboardState(false);
  assert.deepEqual(copied, { label: "Copied", showUrl: false });
  assert.deepEqual(refused, { label: "Clipboard", showUrl: true });
});

test("a page-count warning updates when the PDF or the range changes", () => {
  assert.equal(extractPageCountStatus("This PDF has 38 pages.", "pages", 40, 44, 38), "This PDF has 38 pages.");
  assert.equal(extractPageCountStatus("This PDF has 38 pages.", "pages", 40, 44, 30), "This PDF has 30 pages.");
  assert.equal(extractPageCountStatus("This PDF has 38 pages.", "pages", 40, 44, 50), "");
  assert.equal(extractPageCountStatus("This PDF has 38 pages.", "pages", 3, 5, 38), "");
  assert.equal(extractPageCountStatus("Extracting page 3", "pages", 40, 44, 10), "Extracting page 3");
});

test("the extract button names the open and save steps", () => {
  assert.equal(extractButtonLabel(false), "Extract");
  assert.equal(extractButtonLabel(true), "Save Extract");
});

test("a saved extract closes the range so the button returns to Extract", () => {
  assert.equal(extractPanelOpenAfterSave(1), false);
  assert.equal(extractPanelOpenAfterSave(3), false);
  assert.equal(extractPanelOpenAfterSave(0), true);
  assert.equal(extractButtonLabel(extractPanelOpenAfterSave(1)), "Extract");
});

test("show all extracts keeps a saved page range together", () => {
  const pages = [10, 8, 9, 7, 5, 6, 4].map((page) => ({
    key: `BOX005/0003-p${page}-20261022T1201${String(page).padStart(2, "0")}Z.jpg`,
    folder: "BOX005",
    filename: "0003.pdf",
    page,
    createdAt: `2026-10-22T12:01:${String(page).padStart(2, "0")}Z`,
  }));
  const later = {
    key: "BOX005/0003-p1-20261022T130000Z.jpg",
    folder: "BOX005",
    filename: "0003.pdf",
    page: 1,
    createdAt: "2026-10-22T13:00:00Z",
  };
  const groups = groupExtractRanges([...pages, later]);
  assert.equal(groups.length, 2);
  const range = groups.find((group) => group.label === "p. 4–10");
  assert.deepEqual(range.pages, [4, 5, 6, 7, 8, 9, 10]);
  assert.equal(range.keys.length, 7);
  assert.equal(groups.find((group) => group.page === 1), undefined);
  assert.equal(groups.find((group) => group.label === "p. 1").keys.length, 1);
  const stamped = [4, 10].map((page) => ({
    key: `BOX005/0003-p${page}-20261022T140000Z.jpg`,
    folder: "BOX005",
    filename: "0003.pdf",
    page,
    stamp: "20261022T140000Z",
    createdAt: page === 4 ? "2026-10-22T14:00:00Z" : "2026-10-22T14:20:00Z",
  }));
  assert.equal(groupExtractRanges(stamped)[0].label, "p. 4, 10");
  assert.equal(formatExtractPageLabel([3]), "p. 3");
});

test("a single page range follows the viewer and a typed range stays", () => {
  assert.deepEqual(nextExtractRange("3", "3", 8), { from: "8", to: "8" });
  assert.deepEqual(nextExtractRange("40", "44", 3), { from: "40", to: "44" });
});

test("a failed second extract keeps the Clipboard link from the first", () => {
  const first = [{ url: "https://extracts.example/page-1.jpg", key: "BOX016/a-p1.jpg" }];
  assert.deepEqual(keptExtractItems(first, []), first);
  const second = [{ url: "https://extracts.example/page-2.jpg", key: "BOX016/a-p2.jpg" }];
  assert.deepEqual(keptExtractItems(first, second), second);
});

test("extract range and Clipboard stay on the viewer bar", () => {
  const html = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
  const barStart = html.indexOf('id="pdfsearch-viewer-bar"');
  const overlayAt = html.indexOf('id="pdfsearch-viewer-extract-overlay"');
  const bar = html.slice(barStart, overlayAt);
  const rangeAt = bar.indexOf('id="pdfsearch-viewer-extract-range"');
  const extractAt = bar.indexOf('id="pdfsearch-viewer-extract"');
  const printAt = bar.indexOf('id="pdfsearch-viewer-print"');
  const downloadAt = bar.indexOf('id="pdfsearch-viewer-download"');
  const closeAt = bar.indexOf('id="pdfsearch-viewer-close"');
  assert.ok(rangeAt > 0, "page range is in the viewer bar");
  assert.ok(extractAt > rangeAt, "Save Extract follows the page range");
  assert.ok(printAt > extractAt, "Clipboard follows Save Extract");
  assert.ok(downloadAt > printAt, "Download follows Clipboard");
  assert.ok(closeAt > downloadAt, "Close follows Download");
  const overlay = html.slice(overlayAt, html.indexOf("</div>", overlayAt) + 6);
  assert.equal(overlay.includes("pdfsearch-viewer-extract-from"), false);
  assert.equal(overlay.includes("pdfsearch-viewer-print"), false);
  assert.match(bar, /id="pdfsearch-viewer-goto"[^>]*\bhidden\b/);
  assert.match(bar, /id="pdfsearch-viewer-extract-controls"[^>]*\bhidden\b/);
});

test("a closed extract overlay opens and an open one extracts", () => {
  assert.equal(extractOverlayAction(true), "open");
  assert.equal(extractOverlayAction(false), "extract");
});

test("extract remove can delete the checked pages or every page", () => {
  const keys = ["BOX013/0007-p21-20261008T120000Z.jpg", "BOX013/0007-p15-20261008T120100Z.jpg", "BOX004/0005-p40-20261007T200000Z.jpg"];
  assert.deepEqual(extractKeysToRemove(keys, [keys[0], keys[2]]), [keys[0], keys[2]]);
  assert.deepEqual(extractKeysToRemove(keys, []), []);
  assert.deepEqual(extractKeysToRemove(keys, ["missing"]), []);
  assert.deepEqual(extractKeysToRemove(keys, [], { all: true }), keys);
  assert.deepEqual(extractKeysToRemove(["", keys[0], keys[0]], [keys[0]], { all: true }), [keys[0]]);
});

test("print-page remove needs a key and a sign-in before it deletes", () => {
  const keyed = [{ url: "https://extracts.example/page-1.jpg", key: "BOX002/0002-p1-20261007T191250Z.jpg" }];
  assert.deepEqual(extractRemovePlan([{ url: "https://extracts.example/page-1.jpg" }], true), {
    action: "list",
    keys: [],
  });
  assert.equal(extractRemovePlan(keyed, false).action, "signin");
  assert.deepEqual(extractRemovePlan(keyed, true), {
    action: "delete",
    keys: ["BOX002/0002-p1-20261007T191250Z.jpg"],
  });
});

test("entire PDF lists every page and a range stays inside the document", () => {
  assert.deepEqual(extractPageList("all", 1, 1, 3).pages, [1, 2, 3]);
  assert.deepEqual(extractPageList("pages", 10, 12, 20).pages, [10, 11, 12]);
  assert.deepEqual(extractPageList("pages", 4, 4, 9).pages, [4]);
  assert.equal(extractPageList("pages", 3, 1, 9).error, "The first page must come before the last page.");
  assert.equal(extractPageList("pages", 1, 5, 3).error, "This PDF has 3 pages.");
  assert.equal(extractPageList("all", 1, 1, 0).error, "This PDF has no pages.");
});

test("a print link round-trips the page image URLs", () => {
  const urls = [
    "https://extracts.example/page-1.jpg",
    "https://extracts.example/page-2.jpg",
  ];
  const href = extractPrintHref(urls);
  assert.match(href, /^extract\.html#/);
  assert.deepEqual(extractPrintUrls(href.slice("extract.html".length)), urls);
  assert.deepEqual(extractPrintUrls("#not-json"), []);
  assert.equal(extractPrintHref(["http://insecure.example/a.jpg"]), "");
  const keyed = extractPrintHref([{ url: urls[0], key: "BOX002/0002_WENNER-p10-20261007T191250Z.jpg" }]);
  assert.deepEqual(extractPrintItems(keyed.slice("extract.html".length)), [
    { url: urls[0], key: "BOX002/0002_WENNER-p10-20261007T191250Z.jpg" },
  ]);
});

test("a print URL is the absolute shareable link", () => {
  const href = extractPrintUrl(
    [{ url: "https://extracts.example/page-1.jpg", key: "BOX002/0002-p1-20261007T191250Z.jpg" }],
    "https://dev.dliv.com/index.html"
  );
  assert.match(href, /^https:\/\/dev\.dliv\.com\/extract\.html#/);
  assert.equal(extractPrintUrl([], "https://dev.dliv.com/"), "");
});

test("a long print link still round-trips for Clipboard", () => {
  const urls = Array.from({ length: 40 }, (_, i) => `https://extracts.example/${"a".repeat(200)}-${i}.jpg`);
  const href = extractPrintHref(urls);
  assert.match(href, /^extract\.html#/);
  assert.deepEqual(extractPrintUrls(href.slice("extract.html".length)), urls);
});
