import { test } from "node:test";
import assert from "node:assert/strict";
import { formatS3UploadProgress, formatUploadBytes, s3ProgressView, uploadErrorMessage } from "../frontend/s3Upload.js";

test("maps browser network failures to a disc retry message", () => {
  assert.match(uploadErrorMessage(new TypeError("Failed to fetch")), /Keep this tab open/);
  assert.match(uploadErrorMessage(new TypeError("Load failed")), /Keep this tab open/);
});

test("leaves specific upload errors intact", () => {
  assert.equal(uploadErrorMessage(new Error("Part 3 failed: HTTP 403")), "Part 3 failed: HTTP 403");
});

test("formats in-flight S3 multipart progress", () => {
  assert.equal(
    formatS3UploadProgress({ file: "VTS_01_1.VOB", parts: 26, bytes: 218103808 }),
    "VTS_01_1.VOB · 26 parts · 208.0 MB",
  );
});

test("progress bar uses current bytes versus expected bytes", () => {
  assert.equal(formatUploadBytes(218103808), "208.0 MB");
  assert.equal(formatUploadBytes(2362232012), "2.20 GB");
  assert.deepEqual(s3ProgressView(218103808, 2362232012), {
    percent: 9,
    label: "208.0 MB / 2.20 GB",
  });
  assert.deepEqual(s3ProgressView(2362232012, 2362232012), {
    percent: 100,
    label: "2.20 GB / 2.20 GB",
  });
  assert.equal(s3ProgressView(10, 0), null);
});
