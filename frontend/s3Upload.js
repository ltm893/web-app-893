// s3Upload.js — browser PUT to a presigned S3 URL (single object or multipart)

const PART_SIZE = 8 * 1024 * 1024;
const PART_ATTEMPTS = 5;

function mb(n) {
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function log(event, detail) {
  console.log(`[s3-multipart] ${event}`, detail);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatUploadBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}

export function s3ProgressView(currentBytes, expectedBytes) {
  const expected = Number(expectedBytes);
  if (!(expected > 0)) return null;
  const current = Math.max(0, Number(currentBytes) || 0);
  const percent = Math.max(0, Math.min(100, Math.round((current / expected) * 100)));
  return {
    percent,
    label: `${formatUploadBytes(current)} / ${formatUploadBytes(expected)}`,
  };
}

export function formatS3UploadProgress(progress) {
  if (!progress || !Number(progress.parts)) return "";
  const mb = (Number(progress.bytes) / 1048576).toFixed(1);
  const file = String(progress.file || "upload");
  return `${file} · ${progress.parts} parts · ${mb} MB`;
}

export function uploadErrorMessage(err) {
  const msg = String(err?.message || err || "");
  if (/failed to fetch|networkerror|load failed|network connection was lost/i.test(msg)) {
    return "Lost connection while reading the disc. Keep this tab open and try Upload DVD again.";
  }
  return msg || "Upload failed";
}

export async function putObject(url, body, contentType) {
  const headers = {};
  if (contentType) headers["Content-Type"] = contentType;
  const res = await fetch(url, { method: "PUT", headers, body });
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
  return res;
}

async function putPartWithRetry(file, start, end, signPart, key, uploadId, partNumber) {
  let lastErr;
  for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
    try {
      const blob = file.slice(start, end);
      const body = await blob.arrayBuffer();
      const signed = await signPart({ key, uploadId, partNumber });
      const url = signed.url || signed.urls?.[0]?.url;
      if (!url) throw new Error(`No URL for part ${partNumber}`);
      const t0 = performance.now();
      const res = await fetch(url, { method: "PUT", body });
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) throw new Error(`Part ${partNumber} failed: HTTP ${res.status}`);
      const etag = (res.headers.get("ETag") || "").replaceAll('"', "");
      if (!etag) throw new Error(`Part ${partNumber} missing ETag`);
      return { etag, ms, bytes: body.byteLength };
    } catch (err) {
      lastErr = err;
      log("retry-part", {
        part: partNumber,
        attempt,
        error: err?.message || String(err),
      });
      if (attempt < PART_ATTEMPTS) await sleep(1000 * attempt);
    }
  }
  throw new Error(uploadErrorMessage(lastErr));
}

export async function putMultipart(file, handlers, { contentType, onProgress } = {}) {
  const initiate = handlers.initiate;
  const signPart = handlers.signPart;
  const complete = handlers.complete;
  const abort = handlers.abort;
  const type = contentType || file.type || "application/octet-stream";
  const total = Math.max(1, Math.ceil(file.size / PART_SIZE));
  log("start", {
    name: file.name,
    size: file.size,
    sizeMB: mb(file.size),
    parts: total,
    partSize: mb(PART_SIZE),
  });
  const started = await initiate({ contentType: type });
  const key = started.key;
  const uploadId = started.uploadId;
  if (!key || !uploadId) throw new Error("Upload did not start");
  log("initiated", { key, uploadId, parts: total });
  const parts = [];
  let uploadedBytes = 0;
  try {
    for (let i = 0; i < total; i++) {
      const partNumber = i + 1;
      const start = i * PART_SIZE;
      const end = Math.min(file.size, start + PART_SIZE);
      log("sign-part", { part: partNumber, total, bytes: end - start, sizeMB: mb(end - start) });
      const put = await putPartWithRetry(file, start, end, signPart, key, uploadId, partNumber);
      uploadedBytes += put.bytes;
      parts.push({ partNumber, etag: put.etag });
      log("put-part", {
        part: partNumber,
        total,
        bytes: put.bytes,
        sizeMB: mb(put.bytes),
        etag: put.etag,
        ms: put.ms,
      });
      onProgress?.(partNumber, total, {
        bytes: put.bytes,
        uploadedBytes,
        fileSize: file.size,
        partSize: PART_SIZE,
        etag: put.etag,
        ms: put.ms,
      });
    }
    log("complete", { key, uploadId, parts: parts.length });
    await complete({ key, uploadId, parts });
    log("done", { key, parts: parts.length });
    return { key };
  } catch (err) {
    log("abort", { key, uploadId, error: err?.message || String(err) });
    try { await abort({ key, uploadId }); } catch { /* ignore */ }
    throw err;
  }
}
