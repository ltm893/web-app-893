import { test } from "node:test";
import assert from "node:assert/strict";
import { latestJobsByName } from "../frontend/videoJobs.js";

test("a re-upload hides the older converted card with the same name", () => {
  const rows = latestJobsByName([
    { jobId: "new", filename: "TrentonHS", status: "CONVERTING", createdAt: "2026-09-30T10:00:00Z" },
    { jobId: "old", filename: "TrentonHS", status: "READY", createdAt: "2026-09-29T10:00:00Z" },
    { jobId: "camp-new", filename: "CampingDragRacing", status: "READY", createdAt: "2026-09-30T10:00:00Z" },
    { jobId: "camp-old", filename: "CampingDragRacing", status: "READY", createdAt: "2026-09-28T10:00:00Z" },
  ]);
  assert.deepEqual(rows.map((job) => job.jobId), ["new", "camp-new"]);
});

test("a queued clip stays visible beside an older file with the same name", () => {
  const rows = latestJobsByName([
    { jobId: "clip", filename: "Camping-clip.mp4", status: "QUEUED", createdAt: "2026-10-05T14:00:00Z" },
    { jobId: "old", filename: "Camping-clip", status: "READY", createdAt: "2026-10-01T10:00:00Z" },
  ]);
  assert.deepEqual(rows.map((job) => job.jobId), ["clip"]);
});

test("an in-progress upload wins over an older converted job even without createdAt", () => {
  const rows = latestJobsByName([
    { jobId: "local-1", filename: "Wenner02", status: "UPLOADING" },
    { jobId: "old", filename: "Wenner02.mp4", status: "READY", createdAt: "2026-09-29T10:00:00Z" },
  ]);
  assert.deepEqual(rows.map((job) => job.jobId), ["local-1"]);
});
