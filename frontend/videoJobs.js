export function jobNameKey(job) {
  const name = String(job?.filename || "").trim().toLowerCase();
  const stem = name.replace(/\.(mp4|m4v|mov|mpeg|mpg|avi|mkv|wmv|mp3|aiff|aif|wav|flac|m4a)$/i, "");
  return stem || name || String(job?.jobId || "");
}

function isActiveStatus(status) {
  return status === "UPLOADING" || status === "QUEUED" || status === "CONVERTING";
}

function jobTime(job) {
  return Date.parse(job?.createdAt || "") || Date.parse(job?.updatedAt || "") || 0;
}

export function jobIsCurrent(job, other) {
  if (!other) return true;
  if (isActiveStatus(job.status) !== isActiveStatus(other.status)) {
    return isActiveStatus(job.status);
  }
  const jobTs = jobTime(job);
  const otherTs = jobTime(other);
  if (jobTs !== otherTs) return jobTs > otherTs;
  return String(job.jobId || "") >= String(other.jobId || "");
}

export function latestJobsByName(jobs) {
  const rows = Array.isArray(jobs) ? jobs : [];
  const current = new Map();
  for (const job of rows) {
    const key = jobNameKey(job);
    if (!key) continue;
    const prev = current.get(key);
    if (jobIsCurrent(job, prev)) current.set(key, job);
  }
  const keep = new Set([...current.values()].map((job) => job.jobId));
  return rows.filter((job) => keep.has(job.jobId));
}
