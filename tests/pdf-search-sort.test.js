import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareArchiveName,
  groupedBoxes,
  NEW_BOX_SELECT,
  resolvePdfUploadFolder,
  filterHitsByFolders,
  parseSearchBoxes,
} from "../frontend/pdfSearchSort.js";

test("Browse archives sort BOX numbers then leftover name", () => {
  const names = [
    "BOX016",
    "BOX001",
    "BOX012 TAX RETURN",
    "BOX002",
    "BOX010",
    "BOX012",
  ];
  names.sort(compareArchiveName);
  assert.deepEqual(names, [
    "BOX001",
    "BOX002",
    "BOX010",
    "BOX012",
    "BOX012 TAX RETURN",
    "BOX016",
  ]);
});

test("groupedBoxes lists archives in alphanumeric order", () => {
  const docs = [
    { folder: "BOX016", filename: "z.pdf", key: "BOX016/z.pdf" },
    { folder: "BOX001", filename: "a.pdf", key: "BOX001/a.pdf" },
    { folder: "BOX012 TAX RETURN", filename: "t.pdf", key: "BOX012 TAX RETURN/t.pdf" },
    { folder: "BOX002", filename: "b.pdf", key: "BOX002/b.pdf" },
  ];
  assert.deepEqual(
    groupedBoxes(docs).map((b) => b.folder),
    ["BOX001", "BOX002", "BOX012 TAX RETURN", "BOX016"],
  );
});

test("files in a box sort by numbered filename", () => {
  const docs = [
    { folder: "BOX001", filename: "0008_ANCESTRY.pdf", key: "a" },
    { folder: "BOX001", filename: "0003_BOOK I TAB 10 CHURCH RECORDS ZIEGELS CHURCH.pdf", key: "b" },
    { folder: "BOX001", filename: "0010_UNITED STATES LAND.pdf", key: "c" },
    { folder: "BOX001", filename: "0001_HIGGINS.pdf", key: "d" },
  ];
  assert.deepEqual(
    groupedBoxes(docs)[0].docs.map((d) => d.filename),
    [
      "0001_HIGGINS.pdf",
      "0003_BOOK I TAB 10 CHURCH RECORDS ZIEGELS CHURCH.pdf",
      "0008_ANCESTRY.pdf",
      "0010_UNITED STATES LAND.pdf",
    ],
  );
});

test("Add PDFs can target an existing box from the picker", () => {
  assert.equal(
    resolvePdfUploadFolder("BOX003", "BOX016", ["BOX001", "BOX003"]),
    "BOX003",
  );
});

test("Add PDFs can create a new box from the name field", () => {
  assert.equal(
    resolvePdfUploadFolder(NEW_BOX_SELECT, "BOX016", ["BOX001", "BOX003"]),
    "BOX016",
  );
});

test("existing box names with spaces stay as-is", () => {
  assert.equal(
    resolvePdfUploadFolder("BOX012 TAX RETURN", "", ["BOX012 TAX RETURN"]),
    "BOX012 TAX RETURN",
  );
});

test("picker value must be a known box", () => {
  assert.throws(
    () => resolvePdfUploadFolder("BOX099", "", ["BOX001"]),
    /not in the list/,
  );
});

test("new box name rejects spaces", () => {
  assert.throws(
    () => resolvePdfUploadFolder(NEW_BOX_SELECT, "BOX 4", []),
    /letters, numbers, dots, and hyphens/,
  );
});

test("search hits group by box then filename", () => {
  const hits = [
    { folder: "BOX012 TAX RETURN", filename: "0007.pdf", key: "a" },
    { folder: "BOX005", filename: "0012.pdf", key: "b" },
    { folder: "BOX005", filename: "0006.pdf", key: "c" },
    { folder: "BOX004", filename: "0003.pdf", key: "d" },
  ];
  assert.deepEqual(
    groupedBoxes(hits).map((b) => [b.folder, b.docs.map((d) => d.filename)]),
    [
      ["BOX004", ["0003.pdf"]],
      ["BOX005", ["0006.pdf", "0012.pdf"]],
      ["BOX012 TAX RETURN", ["0007.pdf"]],
    ],
  );
});

test("search can limit hits to selected boxes", () => {
  const hits = [
    { folder: "BOX004", filename: "0003.pdf", key: "a" },
    { folder: "BOX005", filename: "0006.pdf", key: "b" },
    { folder: "BOX012 TAX RETURN", filename: "0001.pdf", key: "c" },
  ];
  assert.deepEqual(
    filterHitsByFolders(hits, ["BOX005", "BOX012 TAX RETURN"]).map((h) => h.filename),
    ["0006.pdf", "0001.pdf"],
  );
  assert.deepEqual(
    filterHitsByFolders(hits, []).map((h) => h.filename),
    ["0003.pdf", "0006.pdf", "0001.pdf"],
  );
});

test("parseSearchBoxes splits and skips bad names", () => {
  assert.deepEqual(
    parseSearchBoxes("BOX005,BOX012 TAX RETURN,../secret"),
    ["BOX005", "BOX012 TAX RETURN"],
  );
});
