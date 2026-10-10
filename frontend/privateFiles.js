// privateFiles.js — invite-only private file browser
import {
  signIn, signOut, getIdToken, ensureSignedIn, authFetch, isAuthError, getDropboxApiUrl,
  getVideoConvertApiUrl, isVideoConvertEnabled, loadingHtml,
} from "./auth.js";
import { putMultipart, formatS3UploadProgress, s3ProgressView, uploadErrorMessage } from "./s3Upload.js";
import { collectConvertFolder, snapshotFileList } from "./discUpload.js";
import { holdWakeLock, releaseWakeLock } from "./wakeLock.js";
import {
  destKeyForRename,
  followRenamedKey,
  folderNameFromKey,
  isFolderKey,
  jobMatchesRenameKey,
  listingReflectsRename,
  parentPrefixOf,
  rememberRenamedKey,
  videoJobTitle,
} from "./privateRename.js";
import {
  compareLibraryFolders,
  isReservedLibraryFolder,
  jobMusicFolderLabel,
  jobMusicFolderPrefix,
  mineLibraryKeys,
  mineRootPrefix,
  musicDirectUploadError,
  libraryAddMenuItems,
  libraryFileMenuItems,
  listingLibrary,
  showFileUploadButton,
  showFolderRenameButton,
  showLibraryAddMenu,
  showLibraryFileMenu,
  showStandaloneFolderButton,
  showVideoEditControls,
  showVideoUploadButton,
} from "./privateFolders.js";
import { latestJobsByName } from "./videoJobs.js";
import { clipRequest, clipTimesFromMarks, combineRequest, formatMediaTimestamp, isMineMp4Key, suggestEditName } from "./videoEdit.js";
import { formatFileSize, formatMediaLength, isPlayableAudioKey, isPlayableVideoKey, keepAppTabTitle, skipMediaTime, VIDEO_NUDGE_SECONDS, VIDEO_SKIP_SECONDS } from "./mediaPlay.js";

let currentPrefix = "";
let currentUserId = null;
let currentUserLabel = "Mine";
let currentTab = "shared";
let currentUserIdentifiers = [];
let filesLoadGen = 0;
const mediaLengthCache = new Map();
const renamedOutputKeys = new Map();
const videoPendingRenames = new Map();
let listOpProgressDepth = 0;

function showListOpProgress(label) {
  const el = document.getElementById("private-op-progress");
  const text = document.getElementById("private-op-progress-label");
  if (text) text.textContent = label;
  if (el) el.hidden = false;
}

function hideListOpProgress() {
  const el = document.getElementById("private-op-progress");
  if (el) el.hidden = true;
}

async function withListOpProgress(label, work) {
  listOpProgressDepth += 1;
  showListOpProgress(label);
  try {
    return await work();
  } finally {
    listOpProgressDepth -= 1;
    if (listOpProgressDepth <= 0) {
      listOpProgressDepth = 0;
      hideListOpProgress();
    }
  }
}

async function reloadFilesAfterOp() {
  await loadFiles(currentPrefix, { keepVisibleList: true });
}

const focusSetUsers = [
  "Wenner2026@gmail.com",
];

function identifiersFromToken(payload) {
  return [payload.sub, payload.email, payload["cognito:username"]]
    .filter(Boolean)
    .map((id) => String(id).toLowerCase());
}

function isFocusSetUser() {
  const set = new Set(focusSetUsers.map((u) => u.toLowerCase()));
  return currentUserIdentifiers.some((id) => set.has(id));
}

function isReservedSharedTopFolder(folderKey) {
  return isReservedLibraryFolder(currentTab, folderKey, currentUserId);
}

function tabRootPrefix() {
  return currentTab === "mine" ? `users/${currentUserId}/` : "";
}

function parentPrefix(prefix) {
  const root = tabRootPrefix();
  if (!prefix || prefix === root) return null;
  const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const parts = trimmed.split("/").filter(Boolean);
  parts.pop();
  if (parts.length === 0) return "";
  const parent = `${parts.join("/")}/`;
  if (currentTab === "mine" && !parent.startsWith(root)) return root;
  return parent;
}

function updateUpButton(prefix) {
  const btn = document.getElementById("private-up-btn");
  if (!btn) return;
  btn.style.display = parentPrefix(prefix) !== null ? "inline-block" : "none";
}

function displayNameFromToken(payload) {
  const name = payload.name || payload.given_name || payload.preferred_username;
  if (name) return name;
  const email = payload.email || payload["cognito:username"];
  if (email?.includes("@")) return email.split("@")[0];
  if (email) return email;
  return payload.sub;
}

// ── Audio player state ────────────────────────────────────────────────────────
let playlist   = [];
let trackIndex = 0;
let audio      = null;

// ── Download mode ─────────────────────────────────────────────────────────────
let downloadMode = false;

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const CAPTIONS_FILENAME = "captions.json";
const SLIDE_INTERVAL_MS = 3000;
let slideKeys = [];
let slideIndex = 0;
let slidePlaying = false;
let slideTimer = null;
let slideLoadTicket = 0;
let captionsCache = { prefix: null, map: {} };
let captionKeys = [];
let captionIndex = 0;
let captionMap = {};
let captionPrefix = "";
let captionLoadTicket = 0;

function fileNameFromKey(key) {
  return (typeof key === "string" ? key.split("/").pop() : "") || "";
}

function isCaptionsSidecar(key) {
  return fileNameFromKey(key).toLowerCase() === CAPTIONS_FILENAME;
}

function captionsKeyForPrefix(prefix) {
  return `${prefix || ""}${CAPTIONS_FILENAME}`;
}

function isImageKey(key) {
  if (typeof key !== "string" || isCaptionsSidecar(key)) return false;
  const name = fileNameFromKey(key).toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTS.has(name.slice(dot + 1));
}

function sortImageFiles(files) {
  return [...files].sort((a, b) =>
    fileNameFromKey(a.key).localeCompare(fileNameFromKey(b.key), undefined, { numeric: true, sensitivity: "base" })
  );
}

function shuffleKeys(keys) {
  const next = [...keys];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

window.initPrivate = async function () {
  setPrivateView("loading");
  if (await ensureSignedIn()) {
    await showFileBrowser();
  } else {
    showLoginForm();
  }
};

function setPrivateView(view) {
  document.getElementById("private-login").style.display   = view === "login" ? "block" : "none";
  document.getElementById("private-loading").style.display = view === "loading" ? "block" : "none";
  document.getElementById("private-browser").style.display = view === "browser" ? "block" : "none";
}

function showLoginForm() {
  setPrivateView("login");
}

function handleSessionExpired() {
  stopPlayer();
  stopVideoPoll();
  closeAddToSlideshow();
  closePrivateSlideshow();
  closePrivateCaptions();
  showLoginForm();
}

async function showFileBrowser() {
  setPrivateView("loading");

  try {
    const token   = await getIdToken();
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    currentUserId    = payload.sub;
    currentUserLabel = displayNameFromToken(payload);
    currentUserIdentifiers = identifiersFromToken(payload);
  } catch {
    handleSessionExpired();
    return;
  }

  currentTab = isFocusSetUser() ? "mine" : "shared";
  currentPrefix = currentTab === "mine" ? mineRootPrefix(currentUserId) : "";
  await syncVideoConvertUi();
  updateTabUI();
  const listEl = document.getElementById("private-file-list");
  if (listEl) listEl.innerHTML = `<li class="file-loading">${loadingHtml("Loading")}</li>`;
  setPrivateView("browser");

  await ensurePrivateFolder();
  loadFiles(currentTab === "shared" ? "" : `users/${currentUserId}/`);
  loadMySlideshows();
}

async function putDirectoryMarker(key) {
  const apiUrl = await getDropboxApiUrl();
  const putRes = await authFetch(`${apiUrl}files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, contentType: "application/x-directory" }),
  });
  if (!putRes.ok) throw new Error(`HTTP ${putRes.status}`);
  const { url } = await putRes.json();
  const uploadRes = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/x-directory" },
    body: "",
  });
  if (!uploadRes.ok) throw new Error(`HTTP ${uploadRes.status}`);
}

async function ensurePrivateFolder() {
  const prefix = mineRootPrefix(currentUserId);
  try {
    const apiUrl = await getDropboxApiUrl();
    const res = await authFetch(`${apiUrl}files?prefix=${encodeURIComponent(prefix)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { folders, files } = await res.json();
    const present = new Set((folders || []).map((f) => f.key));
    const missing = [];
    if ((folders || []).length === 0 && (files || []).length === 0) missing.push(prefix);
    for (const key of mineLibraryKeys(currentUserId)) {
      if (!present.has(key)) missing.push(key);
    }
    await Promise.all(missing.map((key) => putDirectoryMarker(key)));
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    console.warn("Could not ensure private folder:", err.message);
  }
}

function fillLibraryAddMenu() {
  const list = document.getElementById("videos-add-list");
  if (!list) return;
  const items = libraryAddMenuItems(currentTab, currentPrefix, currentUserId, videoConvertOn);
  list.innerHTML = items.map((item) => (
    `<button type="button" onclick="runLibraryAddAction('${item.action}')">${escapeHtml(item.label)}</button>`
  )).join("");
}

function syncUploadButtons() {
  const showFile = showFileUploadButton(currentTab, currentPrefix, currentUserId);
  const showVideo = showVideoUploadButton(currentTab, currentPrefix, currentUserId, videoConvertOn);
  const showAdd = showLibraryAddMenu(currentTab, currentPrefix, currentUserId, videoConvertOn);
  const fileBtn = document.getElementById("private-file-upload-btn");
  if (fileBtn) fileBtn.hidden = !showFile || showAdd;
  const addMenu = document.getElementById("videos-add-menu");
  if (addMenu) addMenu.hidden = !showAdd;
  fillLibraryAddMenu();
  const folderBtn = document.getElementById("private-folder-btn");
  if (folderBtn) folderBtn.hidden = !showStandaloneFolderButton(currentTab, currentPrefix, currentUserId, videoConvertOn);
  document.querySelectorAll("[data-video-upload]").forEach((el) => { el.hidden = !showVideo; });
  if (!showAdd) closeVideosMenus();
  syncVideoEditControls();
  const input = document.getElementById("upload-input");
  if (input) {
    const library = listingLibrary(currentTab, currentPrefix, currentUserId);
    if (library === "Music") input.accept = "audio/mpeg,.mp3";
    else if (library === "Photos") input.accept = "image/*";
    else input.removeAttribute("accept");
  }
  if (!showFile) {
    const area = document.getElementById("upload-area");
    if (area) area.style.display = "none";
  }
}

function updateTabUI() {
  const sharedBtn = document.getElementById("tab-btn-shared");
  const mineBtn   = document.getElementById("tab-btn-mine");
  const videoBtn  = document.getElementById("tab-btn-video");
  const slidesBtn = document.getElementById("tab-btn-slideshows");
  const tabBar    = sharedBtn?.parentElement;
  if (tabBar && mineBtn && sharedBtn) {
    if (isFocusSetUser()) tabBar.insertBefore(mineBtn, sharedBtn);
    else tabBar.insertBefore(sharedBtn, mineBtn);
    if (videoBtn) tabBar.appendChild(videoBtn);
    if (slidesBtn) tabBar.appendChild(slidesBtn);
  }
  sharedBtn?.classList.toggle("active", currentTab === "shared");
  mineBtn?.classList.toggle("active", currentTab === "mine");
  videoBtn?.classList.toggle("active", currentTab === "video");
  slidesBtn?.classList.toggle("active", currentTab === "slideshows");
  if (mineBtn) mineBtn.textContent = currentUserLabel;
  setVideoStatusCopy();
  const onSlides = currentTab === "slideshows";
  const onVideo = currentTab === "video";
  syncUploadButtons();
  document.getElementById("private-files-pane")?.toggleAttribute("hidden", onSlides || onVideo);
  document.getElementById("private-slideshows-manage")?.classList.toggle("is-open", onSlides);
  document.getElementById("private-video-status")?.classList.toggle("is-open", onVideo);
  const crumb = document.getElementById("private-breadcrumb");
  if (crumb) crumb.style.display = onSlides || onVideo ? "none" : "";
}

function syncVideoEditControls() {
  const show = showVideoEditControls(currentTab, currentPrefix, currentUserId, videoConvertOn);
  if (!show) {
    videoCombineMode = false;
    combinePrefillKeys.clear();
  }
  document.querySelectorAll("[data-video-edit]").forEach((el) => { el.hidden = !show || !videoCombineMode; });
  const go = document.getElementById("video-combine-go");
  if (go) go.hidden = !show || !videoCombineMode;
  const toggle = document.getElementById("video-combine-btn");
  if (toggle) toggle.textContent = "Cancel combine";
}

function videoJobIsPending(job) {
  return job.status === "UPLOADING" || job.status === "QUEUED" || job.status === "CONVERTING" || job.renaming;
}

function videoJobPhase(job) {
  if (job.kind === "clip") return { busy: "Clipping", done: "Clipped ✓" };
  if (job.kind === "combine") return { busy: "Combining", done: "Combined ✓" };
  return { busy: "Converting to mp4 in progress", done: "Converted ✓" };
}

window.switchTab = function (tab) {
  if (!currentUserId) return;
  if (tab === "video" && !videoConvertOn) return;
  if (tab !== "mine") videoCombineMode = false;
  currentTab = tab;
  updateTabUI();
  if (tab === "slideshows") {
    loadMySlideshows();
    return;
  }
  if (tab === "video") {
    loadVideoJobs();
    return;
  }
  loadFiles(tab === "shared" ? "" : `users/${currentUserId}/`);
};

// ── Video convert (multipart → Fargate → Mine/Videos) ─────────────────────────
const VIDEO_POLL_MS = 4000;
let videoConvertOn = false;
let videoPollTimer = 0;
let videoRemoteJobs = [];
const videoLocalJobs = new Map();
let videoCombineMode = false;
let combinePrefillKeys = new Set();
let videoEditKeys = [];

async function syncVideoConvertUi() {
  videoConvertOn = await isVideoConvertEnabled();
  const tab = document.getElementById("tab-btn-video");
  if (tab) tab.hidden = !videoConvertOn;
  if (!videoConvertOn && currentTab === "video") {
    currentTab = isFocusSetUser() ? "mine" : "shared";
  }
  updateTabUI();
  return videoConvertOn;
}

function stopVideoPoll() {
  if (videoPollTimer) {
    clearTimeout(videoPollTimer);
    videoPollTimer = 0;
  }
}

function videoJobSummaryState(job) {
  const phase = videoJobPhase(job);
  if (job.renaming) return { text: "Rename in progress", cls: "is-busy" };
  if (job.status === "UPLOADING") return { text: "Uploading", cls: "" };
  if (job.status === "QUEUED" || job.status === "CONVERTING") return { text: phase.busy, cls: "is-busy" };
  if (job.status === "READY") return { text: phase.done, cls: "is-ready" };
  if (job.status === "FAILED") return { text: "Failed", cls: "is-failed" };
  return { text: job.status || "", cls: "" };
}

function videoJobUploadCell(job) {
  if (job.kind === "clip" || job.kind === "combine") return "—";
  if (job.status === "UPLOADING") return `<span class="video-job-state">Uploading</span>`;
  if (job.status === "CONVERTING" || job.status === "READY" || job.status === "FAILED") {
    return `<span class="video-job-state is-ready">Complete ✓</span>`;
  }
  return "—";
}

function videoJobConvertCell(job) {
  const phase = videoJobPhase(job);
  if (job.status === "UPLOADING") return "—";
  if (job.status === "QUEUED" || job.status === "CONVERTING") {
    const label = job.kind === "clip" || job.kind === "combine" ? phase.busy : "In progress";
    return `<span class="video-job-state is-busy">${escapeHtml(label)}</span><span class="video-job-busy-track" aria-hidden="true"><span class="video-job-busy-bar"></span></span>`;
  }
  if (job.status === "READY") return `<span class="video-job-state is-ready">${escapeHtml(phase.done)}</span>`;
  if (job.status === "FAILED") return `<span class="video-job-state is-failed">Failed</span>`;
  return "—";
}

function withRenamedOutputs(job) {
  if (!job) return job;
  const outputKeys = Array.isArray(job.outputKeys)
    ? job.outputKeys.map((key) => followRenamedKey(key, renamedOutputKeys))
    : job.outputKeys;
  const outputPrefix = followRenamedKey(job.outputPrefix || "", renamedOutputKeys);
  const pending = job.jobId ? videoPendingRenames.get(job.jobId) : null;
  return {
    ...job,
    outputKeys,
    outputPrefix: outputPrefix || job.outputPrefix,
    renaming: Boolean(pending),
    renameFromKey: pending?.fromKey || "",
    renameDestKey: pending?.destKey || "",
  };
}

function prefixOfFileKey(key) {
  const k = String(key || "");
  const i = k.lastIndexOf("/");
  return i >= 0 ? k.slice(0, i + 1) : "";
}

function patchListedFileRow(fromKey, nextKey) {
  const listEl = document.getElementById("private-file-list");
  if (!listEl) return;
  const fromEnc = encodeURIComponent(fromKey);
  const nextEnc = encodeURIComponent(nextKey);
  const nextName = fileNameFromKey(nextKey);
  const selector = typeof CSS !== "undefined" && CSS.escape
    ? `li.file-item[data-key="${CSS.escape(fromEnc)}"]`
    : `li.file-item[data-key="${fromEnc.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
  const row = listEl.querySelector(selector);
  if (!row) return;
  row.setAttribute("data-key", nextEnc);
  row.setAttribute("data-name", encodeURIComponent(nextName));
  const icon = isImageKey(nextKey) ? "🖼" : isPlayableAudioKey(nextKey) ? "🎵" : isPlayableVideoKey(nextKey) ? "🎬" : "📄";
  const openAction = isImageKey(nextKey)
    ? `startImageSlideshowAt('${nextEnc}')`
    : `openFile('${nextEnc}')`;
  const link = row.querySelector("a");
  if (link) {
    link.setAttribute("onclick", `${openAction}; return false;`);
    link.textContent = `${icon} ${nextName}`;
  }
  const fileMenu = row.querySelector(".file-menu");
  if (fileMenu) {
    const toggle = fileMenu.querySelector(".file-menu-toggle");
    if (toggle) toggle.setAttribute("onclick", `toggleFileMenu(event, '${nextEnc}')`);
    const menuList = fileMenu.querySelector(".file-menu-list");
    if (menuList) menuList.setAttribute("data-key", nextEnc);
    for (const btn of fileMenu.querySelectorAll(".file-menu-list button")) {
      const fn = btn.getAttribute("onclick") || "";
      if (fn.includes("openClipFromMenu")) btn.setAttribute("onclick", `openClipFromMenu('${nextEnc}')`);
      else if (fn.includes("renameFromMenu")) btn.setAttribute("onclick", `renameFromMenu('${nextEnc}')`);
      else if (fn.includes("startCombineWith")) btn.setAttribute("onclick", `startCombineWith('${nextEnc}')`);
      else if (fn.includes("removeFromMenu")) btn.setAttribute("onclick", `removeFromMenu('${nextEnc}','${encodeURIComponent(nextName)}')`);
    }
  } else {
    const renameBtn = row.querySelector("button.rename");
    if (renameBtn) renameBtn.setAttribute("onclick", `renamePrivateFile('${nextEnc}')`);
  }
  const playBtn = row.querySelector("button.play-btn");
  if (playBtn) playBtn.setAttribute("onclick", `playSingleTrack('${nextEnc}')`);
  const check = row.querySelector("input.file-checkbox");
  if (check) check.setAttribute("data-key", nextKey);
}

async function refreshListingAfterRename(fromKey, nextKey) {
  const destPrefix = isFolderKey(nextKey) ? parentPrefixOf(nextKey) : prefixOfFileKey(nextKey);
  const onFilesTab = currentTab === "mine" || currentTab === "shared";
  const alreadyOnDest = onFilesTab && (!destPrefix || currentPrefix === destPrefix);
  const prefix = alreadyOnDest ? currentPrefix : (destPrefix || currentPrefix);
  if (!onFilesTab && currentTab !== "video") {
    currentTab = "mine";
    updateTabUI();
  }
  if (!onFilesTab && currentTab === "video") return;
  if (alreadyOnDest && !isFolderKey(fromKey)) patchListedFileRow(fromKey, nextKey);
  for (let attempt = 0; attempt < 8; attempt++) {
    const last = attempt === 7;
    const result = await loadFiles(prefix, {
      keepVisibleList: alreadyOnDest || attempt > 0,
      skipRenderWhen: last ? null : (files, folders) => !listingReflectsRename(files, fromKey, nextKey, folders),
    });
    if (result == null) return;
    if (listingReflectsRename(result.files, fromKey, nextKey, result.folders)) return;
    if (!last) await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

function jobS3Bytes(local, remote) {
  const expected = local?.expectedBytes != null
    ? Number(local.expectedBytes)
    : Number(remote?.expectedBytes || 0);
  const uploaded = local?.uploadedBytes != null
    ? Number(local.uploadedBytes)
    : Number(remote?.uploadProgress?.bytes || 0);
  return { expectedBytes: expected, uploadedBytes: uploaded };
}

function mergedVideoJobs() {
  const rows = [];
  const seen = new Set();
  for (const local of videoLocalJobs.values()) {
    seen.add(local.jobId);
    const remote = videoRemoteJobs.find((j) => j.jobId === local.jobId);
    rows.push(withRenamedOutputs({
      ...remote,
      ...local,
      filename: local.filename || remote?.filename || "video",
      status: remote?.status && remote.status !== "UPLOADING" ? remote.status : local.status,
      outputKeys: remote?.outputKeys || local.outputKeys || [],
      error: remote?.error || local.error || "",
      progress: local.progress || formatS3UploadProgress(remote?.uploadProgress),
      ...jobS3Bytes(local, remote),
    }));
  }
  for (const remote of videoRemoteJobs) {
    if (seen.has(remote.jobId)) continue;
    if (remote.status === "FAILED" && /interrupted/i.test(remote.error || "")) continue;
    rows.push(withRenamedOutputs({
      ...remote,
      progress: formatS3UploadProgress(remote.uploadProgress),
      ...jobS3Bytes(null, remote),
    }));
  }
  return latestJobsByName(rows);
}

function videoStatusCopyHtml() {
  const who = escapeHtml(currentUserLabel || "Mine");
  return `Keep this <span class="video-status-tab-name">Format Conversions</span> tab open until the upload finishes — closing this tab or sleeping stops the transfer. Finished MP4s land in ${who} → Videos. MP3s land in a dated folder under ${who} → Music.`;
}

function setVideoStatusCopy() {
  const copy = document.getElementById("private-video-status-copy");
  if (copy) copy.innerHTML = videoStatusCopyHtml();
}

function videoJobProgressBar(job) {
  if (job.status !== "UPLOADING") return "";
  const view = s3ProgressView(job.uploadedBytes, job.expectedBytes);
  if (!view) return "";
  return `<div class="video-job-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${view.percent}" aria-label="S3 ${view.label}">
      <div class="video-job-progress-track"><div class="video-job-progress-fill" style="width:${view.percent}%"></div></div>
      <span class="video-job-progress-label">${escapeHtml(view.label)}</span>
    </div>`;
}

function captureOpenVideoJobs() {
  const open = new Set();
  document.querySelectorAll("#private-video-status-list details.video-job[open]").forEach((el) => {
    if (el.dataset.jobId) open.add(el.dataset.jobId);
  });
  return open;
}

function videoJobIsOpen(job, openIds) {
  if (videoJobIsPending(job)) return true;
  return Boolean(job.jobId && openIds.has(job.jobId));
}

function renderVideoJobs() {
  const list = document.getElementById("private-video-status-list");
  if (!list) return;
  const openIds = captureOpenVideoJobs();
  const rows = mergedVideoJobs();
  setVideoStatusCopy();
  if (!rows.length) {
    list.innerHTML = `<li>No video uploads yet.</li>`;
    return;
  }
  list.innerHTML = rows.map((job) => {
    const jobId = job.jobId || "";
    const name = escapeHtml(videoJobTitle(job));
    const summary = videoJobSummaryState(job);
    const detail = job.progress
      ? escapeHtml(job.progress)
      : job.status === "FAILED"
        ? escapeHtml(job.error || "Conversion failed")
        : "";
    const keys = Array.isArray(job.outputKeys) ? job.outputKeys.filter(Boolean) : [];
    const renameBusy = job.renaming
      ? `<span class="video-job-state is-busy">Rename in progress</span><span class="video-job-busy-track" aria-hidden="true"><span class="video-job-busy-bar"></span></span>`
      : "";
    const destLabel = job.renameDestKey
      ? escapeHtml(folderNameFromKey(job.renameDestKey) || String(job.renameDestKey).split("/").pop() || "")
      : "";
    const fileRows = job.renaming
      ? `<tr><th>File</th><td>${renameBusy}${destLabel ? `<span class="video-job-progress-label">${destLabel}</span>` : ""}</td></tr>`
      : job.status === "READY"
      ? keys.map((key) => {
        const label = escapeHtml(String(key).split("/").pop() || "video.mp4");
        return `<tr><th>File</th><td><a href="#" onclick="openFile('${encodeURIComponent(key)}'); return false;">${label}</a> · <a href="#" onclick="renamePrivateFile('${encodeURIComponent(key)}'); return false;">Rename</a></td></tr>`;
      }).join("")
      : "";
    const folderRow = job.status === "READY"
      ? `<tr><th>Folder</th><td><a href="#" onclick="${jobOutputFolderAction(job)}">${escapeHtml(jobOutputFolderLabel(job))}</a>${jobOutputIsMusic(job) ? ` · <a href="#" onclick="renamePrivateFolder('${encodeURIComponent(jobMusicFolderPrefix(currentUserId, job))}'); return false;">Rename</a>` : ""}</td></tr>`
      : "";
    const progress = videoJobProgressBar(job);
    const openAttr = videoJobIsOpen(job, openIds) ? " open" : "";
    return `<li>
      <details class="video-job" data-job-id="${escapeHtml(jobId)}"${openAttr}>
        <summary><span class="video-job-name">${name}</span> <span class="video-job-summary-state ${summary.cls}">${escapeHtml(summary.text)}</span></summary>
        <table class="video-job-table">
          <tbody>
            <tr><th>Upload</th><td>${videoJobUploadCell(job)}</td></tr>
            <tr><th>Convert</th><td>${videoJobConvertCell(job)}</td></tr>
            ${progress ? `<tr><th>Progress</th><td>${progress}</td></tr>` : ""}
            ${detail ? `<tr><th>Detail</th><td>${detail}</td></tr>` : ""}
            ${fileRows}
            ${folderRow}
            <tr><th>Actions</th><td><a href="#" onclick="removeVideoJob('${encodeURIComponent(jobId)}', '${encodeURIComponent(job.filename || "video")}'); return false;">Remove</a></td></tr>
          </tbody>
        </table>
      </details>
    </li>`;
  }).join("");
}

async function fetchVideoJobs() {
  const apiUrl = await getVideoConvertApiUrl();
  if (!apiUrl) return [];
  const res = await authFetch(`${apiUrl}jobs`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return Array.isArray(data.jobs) ? data.jobs : [];
}

function scheduleVideoPoll() {
  stopVideoPoll();
  const pending = mergedVideoJobs().some((j) => videoJobIsPending(j));
  if (!pending) return;
  videoPollTimer = setTimeout(() => { loadVideoJobs(); }, VIDEO_POLL_MS);
}

async function loadVideoJobs() {
  if (!videoConvertOn) {
    renderVideoJobs();
    return;
  }
  try {
    videoRemoteJobs = await fetchVideoJobs();
    for (const remote of videoRemoteJobs) {
      const local = videoLocalJobs.get(remote.jobId);
      if (!local) continue;
      if (remote.status === "READY" || remote.status === "FAILED" || remote.status === "CONVERTING" || remote.status === "QUEUED") {
        if (remote.status !== "CONVERTING" || local.status !== "UPLOADING") {
          local.status = remote.status;
        }
        if (remote.status !== "UPLOADING" && remote.status !== "QUEUED") local.progress = "";
        if (remote.status === "READY" || remote.status === "FAILED") {
          videoLocalJobs.delete(remote.jobId);
        }
      }
    }
    settlePendingVideoRenames();
    renderVideoJobs();
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    const list = document.getElementById("private-video-status-list");
    if (list && !mergedVideoJobs().length) {
      list.innerHTML = `<li style="color:red">${escapeHtml(err.message || "Could not load video conversions")}</li>`;
    }
  }
  scheduleVideoPoll();
}

window.openMineVideos = function (encodedPrefix) {
  if (!currentUserId) return;
  currentTab = "mine";
  updateTabUI();
  const root = `users/${currentUserId}/Videos/`;
  let prefix = root;
  if (encodedPrefix) {
    const next = decodeURIComponent(encodedPrefix);
    if (next.startsWith(root) && !next.includes("..")) {
      prefix = next.endsWith("/") ? next : `${next}/`;
    }
  }
  loadFiles(prefix);
};

window.openMineMusic = function (encodedPrefix) {
  if (!currentUserId) return;
  currentTab = "mine";
  updateTabUI();
  const root = `users/${currentUserId}/Music/`;
  let prefix = root;
  if (encodedPrefix) {
    const next = decodeURIComponent(encodedPrefix);
    if (next.startsWith(root) && !next.includes("..")) {
      prefix = next.endsWith("/") ? next : `${next}/`;
    }
  }
  loadFiles(prefix);
};

function jobOutputIsMusic(job) {
  const prefix = String(job?.outputPrefix || "");
  const keys = Array.isArray(job?.outputKeys) ? job.outputKeys : [];
  return prefix.includes("/Music/") || prefix.endsWith("Music/") || keys.some((key) => String(key).includes("/Music/"));
}

function jobVideoFolderPrefix(job) {
  const root = currentUserId ? `users/${currentUserId}/Videos/` : "";
  const prefix = String(job?.outputPrefix || "");
  if (root && prefix.startsWith(root)) return prefix.endsWith("/") ? prefix : `${prefix}/`;
  return root;
}

function jobOutputFolderLabel(job) {
  const who = currentUserLabel || "Mine";
  if (jobOutputIsMusic(job)) return jobMusicFolderLabel(who, currentUserId, job);
  const prefix = jobVideoFolderPrefix(job);
  const root = currentUserId ? `users/${currentUserId}/Videos/` : "";
  const rest = root && prefix.startsWith(root) ? prefix.slice(root.length).replace(/\/$/, "") : "";
  return rest ? `${who} → Videos → ${rest}` : `${who} → Videos`;
}

function jobOutputFolderAction(job) {
  if (jobOutputIsMusic(job)) {
    return `openMineMusic('${encodeURIComponent(jobMusicFolderPrefix(currentUserId, job))}'); return false;`;
  }
  const prefix = jobVideoFolderPrefix(job);
  const root = currentUserId ? `users/${currentUserId}/Videos/` : "";
  if (prefix && prefix !== root) return `openMineVideos('${encodeURIComponent(prefix)}'); return false;`;
  return "openMineVideos(); return false;";
}

window.renamePrivateFile = async function (encodedKey) {
  const fromKey = decodeURIComponent(encodedKey || "");
  if (isFolderKey(fromKey)) return window.renamePrivateFolder(encodedKey);
  const currentName = fromKey.split("/").pop() || "";
  const typed = prompt("New file name", currentName);
  if (typed == null) return;
  await runPrivateRename(fromKey, typed);
};

window.renamePrivateFolder = async function (encodedKey) {
  let fromKey = decodeURIComponent(encodedKey || "");
  if (fromKey && !fromKey.endsWith("/")) fromKey += "/";
  const currentName = folderNameFromKey(fromKey);
  const typed = prompt("New folder name", currentName);
  if (typed == null) return;
  await runPrivateRename(fromKey, typed);
};

async function runPrivateRename(fromKey, typed) {
  let dest;
  try {
    dest = destKeyForRename(fromKey, typed);
  } catch (err) {
    alert(err.message || "Could not rename");
    return;
  }
  if (dest.unchanged) return;
  if (!(await ensureSignedIn())) { handleSessionExpired(); return; }
  await withListOpProgress("Renaming", async () => {
  const onVideoTab = currentTab === "video";
  let nextKey = dest.destKey;
  markJobsRenaming(dest.fromKey, nextKey);
  renderVideoJobs();
  scheduleVideoPoll();
  try {
    const apiUrl = await getDropboxApiUrl();
    let filesOk = false;
    try {
      const res = await authFetch(`${apiUrl}files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: dest.fromKey, name: typed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        nextKey = data.key || dest.destKey;
        filesOk = true;
      } else if (!isTransientRenameStatus(res.status)) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      if (isAuthError(err)) throw err;
      if (!isTransientRenameError(err)) throw err;
    }
    rememberRenameMapping(dest.fromKey, nextKey);
    retargetPendingRenames(dest.fromKey, nextKey);
    applyRenamedOutputLocally(dest.fromKey, nextKey);
    renderVideoJobs();
    const landed = filesOk || await waitUntilListingReflectsRename(dest.fromKey, nextKey);
    if (!landed) throw new Error("Rename is still running. Check the folder in a moment to confirm.");
    rememberRenameMapping(dest.fromKey, nextKey);
    applyRenamedOutputLocally(dest.fromKey, nextKey);
    await persistRenamedVideoOutput(dest.fromKey, nextKey);
    clearJobsRenaming(nextKey);
    renderVideoJobs();
    if (onVideoTab) await loadVideoJobs();
    else await refreshListingAfterRename(dest.fromKey, nextKey);
  } catch (err) {
    clearJobsRenaming();
    renderVideoJobs();
    if (isAuthError(err)) { handleSessionExpired(); return; }
    alert("Could not rename: " + (err.message || "Error"));
  }
  });
}

function isTransientRenameStatus(status) {
  return status === 408 || status === 502 || status === 503 || status === 504;
}

function isTransientRenameError(err) {
  const status = Number(err?.status || err?.statusCode || 0);
  if (isTransientRenameStatus(status)) return true;
  return /timeout|timed out|failed to fetch|network|HTTP 504|HTTP 502|HTTP 503/i.test(String(err?.message || err || ""));
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function videoJobsMatchingKey(fromKey) {
  const rows = [];
  for (const job of videoRemoteJobs) {
    if (jobMatchesRenameKey(job, fromKey) || jobMatchesRenameKey(withRenamedOutputs(job), fromKey)) {
      rows.push(job);
    }
  }
  for (const job of videoLocalJobs.values()) {
    if (jobMatchesRenameKey(job, fromKey)) rows.push(job);
  }
  return rows;
}

function markJobsRenaming(fromKey, destKey) {
  for (const job of videoJobsMatchingKey(fromKey)) {
    if (job.jobId) videoPendingRenames.set(job.jobId, { fromKey, destKey });
  }
}

function retargetPendingRenames(fromKey, destKey) {
  for (const [jobId, pending] of videoPendingRenames) {
    if (pending.fromKey === fromKey) videoPendingRenames.set(jobId, { ...pending, destKey });
  }
}

function rememberRenameMapping(fromKey, destKey) {
  rememberRenamedKey(renamedOutputKeys, fromKey, destKey);
  if (!String(fromKey).endsWith("/")) return;
  const fromP = fromKey;
  const destP = destKey.endsWith("/") ? destKey : `${destKey}/`;
  for (const job of [...videoRemoteJobs, ...videoLocalJobs.values()]) {
    for (const key of Array.isArray(job?.outputKeys) ? job.outputKeys : []) {
      const k = String(key || "");
      if (k.startsWith(fromP)) rememberRenamedKey(renamedOutputKeys, k, `${destP}${k.slice(fromP.length)}`);
    }
  }
}

function applyRenamedOutputLocally(fromKey, destKey) {
  if (String(fromKey).endsWith("/")) {
    const fromP = fromKey;
    const destP = destKey.endsWith("/") ? destKey : `${destKey}/`;
    videoRemoteJobs = videoRemoteJobs.map((job) => {
      if (!jobMatchesRenameKey(job, fromP)) return job;
      const keys = Array.isArray(job.outputKeys) ? job.outputKeys : [];
      const next = keys.map((key) => (
        String(key).startsWith(fromP) ? `${destP}${String(key).slice(fromP.length)}` : key
      ));
      let outputPrefix = String(job.outputPrefix || "");
      const norm = outputPrefix.endsWith("/") || !outputPrefix ? outputPrefix : `${outputPrefix}/`;
      if (norm === fromP) outputPrefix = destP;
      else if (norm.startsWith(fromP)) outputPrefix = `${destP}${norm.slice(fromP.length)}`;
      return { ...job, outputKeys: next, outputPrefix };
    });
    return;
  }
  const fromName = String(fromKey || "").split("/").pop() || "";
  videoRemoteJobs = videoRemoteJobs.map((job) => {
    const pending = job.jobId && videoPendingRenames.get(job.jobId);
    if (!pending && !jobMatchesRenameKey(job, fromKey)) return job;
    const keys = Array.isArray(job.outputKeys) ? job.outputKeys : [];
    const next = keys.map((key) => (
      key === fromKey || String(key).split("/").pop() === fromName ? destKey : key
    ));
    return { ...job, outputKeys: next.length ? next : [destKey] };
  });
}

function remoteJobHasOutputKey(destKey) {
  const dest = String(destKey || "");
  return videoRemoteJobs.some((job) => {
    const keys = Array.isArray(job.outputKeys) ? job.outputKeys : [];
    const prefix = followRenamedKey(job.outputPrefix || "", renamedOutputKeys);
    if (dest.endsWith("/")) {
      return prefix === dest || keys.some((key) => followRenamedKey(key, renamedOutputKeys).startsWith(dest));
    }
    return keys.some((key) => followRenamedKey(key, renamedOutputKeys) === dest);
  });
}

function settlePendingVideoRenames() {
  for (const [jobId, pending] of [...videoPendingRenames.entries()]) {
    const remote = videoRemoteJobs.find((job) => job.jobId === jobId);
    const keys = Array.isArray(remote?.outputKeys) ? remote.outputKeys : [];
    const dest = String(pending.destKey || "");
    const prefix = followRenamedKey(remote?.outputPrefix || "", renamedOutputKeys);
    const landed = dest.endsWith("/")
      ? prefix === dest || keys.some((key) => followRenamedKey(key, renamedOutputKeys).startsWith(dest))
      : keys.some((key) => followRenamedKey(key, renamedOutputKeys) === dest);
    if (landed) videoPendingRenames.delete(jobId);
  }
}

function clearJobsRenaming(destKey) {
  if (!destKey) {
    videoPendingRenames.clear();
    return;
  }
  for (const [jobId, pending] of [...videoPendingRenames.entries()]) {
    if (pending.destKey === destKey) videoPendingRenames.delete(jobId);
  }
}

async function fetchListingAtPrefix(prefix) {
  const apiUrl = await getDropboxApiUrl();
  const url = prefix
    ? `${apiUrl}files?prefix=${encodeURIComponent(prefix)}&_=${Date.now()}`
    : `${apiUrl}files?_=${Date.now()}`;
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return {
    files: Array.isArray(data.files) ? data.files : [],
    folders: Array.isArray(data.folders) ? data.folders : [],
  };
}

async function waitUntilListingReflectsRename(fromKey, nextKey) {
  const prefix = isFolderKey(nextKey) ? parentPrefixOf(nextKey) : prefixOfFileKey(nextKey);
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const listing = await fetchListingAtPrefix(prefix);
      if (listingReflectsRename(listing.files, fromKey, nextKey, listing.folders)) return true;
    } catch (err) {
      if (isAuthError(err)) throw err;
    }
    await waitMs(2000);
  }
  return false;
}

async function persistRenamedVideoOutput(fromKey, destKey) {
  const apiUrl = await getVideoConvertApiUrl();
  if (!apiUrl) return false;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const res = await authFetch(`${apiUrl}jobs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromKey, destKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        for (const job of Array.isArray(data.jobs) ? data.jobs : []) {
          const i = videoRemoteJobs.findIndex((row) => row.jobId === job.jobId);
          if (i >= 0) {
            videoRemoteJobs[i] = {
              ...videoRemoteJobs[i],
              outputKeys: job.outputKeys,
              outputPrefix: job.outputPrefix || videoRemoteJobs[i].outputPrefix,
            };
          }
        }
        if (Number(data.updated) > 0 || (Array.isArray(data.jobs) && data.jobs.length)) {
          settlePendingVideoRenames();
          return true;
        }
      }
    } catch {
      // Retry until Format Conversions has the new key.
    }
    await waitMs(400);
  }
  return remoteJobHasOutputKey(destKey);
}

async function forgetConvertedVideo(body) {
  const apiUrl = await getVideoConvertApiUrl();
  if (!apiUrl) return null;
  try {
    const res = await authFetch(`${apiUrl}jobs`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const gone = new Set(Array.isArray(data.removed) ? data.removed : []);
    if (gone.size) {
      videoRemoteJobs = videoRemoteJobs.filter((job) => !gone.has(job.jobId));
      for (const id of gone) videoLocalJobs.delete(id);
    }
    for (const job of Array.isArray(data.jobs) ? data.jobs : []) {
      const i = videoRemoteJobs.findIndex((row) => row.jobId === job.jobId);
      if (i >= 0) videoRemoteJobs[i] = { ...videoRemoteJobs[i], outputKeys: job.outputKeys };
    }
    renderVideoJobs();
    return data;
  } catch {
    return null;
  }
}

window.removeVideoJob = async function (encodedJobId, encodedName) {
  const jobId = decodeURIComponent(encodedJobId || "");
  const name = decodeURIComponent(encodedName || "video");
  if (!confirm(`Remove “${name}”? This stops conversion if it is still running, and deletes the converted file, the Format Conversions row, and the original upload.`)) return;
  if (!(await ensureSignedIn())) { handleSessionExpired(); return; }
  const job = mergedVideoJobs().find((row) => row.jobId === jobId);
  const keys = Array.isArray(job?.outputKeys) ? job.outputKeys.filter(Boolean) : [];
  try {
    const dropbox = await getDropboxApiUrl();
    for (const key of keys) {
      const res = await authFetch(`${dropbox}files/${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(res.status === 403 ? "Could not delete the MP4" : `HTTP ${res.status}`);
    }
    const forgotten = await forgetConvertedVideo({ jobId });
    if (!forgotten) throw new Error("Could not remove the convert job");
    if (currentTab === "mine" || currentTab === "shared") loadFiles(currentPrefix);
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    alert("Could not remove: " + (err.message || "Error"));
  }
};

function openVideoStatusTab() {
  currentTab = "video";
  updateTabUI();
}

function beginLocalVideoJob(filename, sizes = {}) {
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  videoLocalJobs.set(localId, {
    jobId: localId,
    filename,
    status: "UPLOADING",
    progress: "Starting…",
    outputKeys: [],
    expectedBytes: Number(sizes.expectedBytes) || 0,
    uploadedBytes: Number(sizes.uploadedBytes) || 0,
  });
  renderVideoJobs();
  return localId;
}

function adoptVideoJob(localId, jobId, filename) {
  const row = videoLocalJobs.get(localId) || { filename, outputKeys: [] };
  videoLocalJobs.delete(localId);
  videoLocalJobs.set(jobId, {
    ...row,
    jobId,
    filename: filename || row.filename,
    status: "UPLOADING",
    progress: "Uploading…",
  });
  renderVideoJobs();
}

function failLocalVideoJob(jobId, localId, err) {
  const row = videoLocalJobs.get(jobId) || videoLocalJobs.get(localId);
  if (row) {
    row.status = "FAILED";
    row.progress = "";
    row.error = uploadErrorMessage(err);
  }
  renderVideoJobs();
}

function closeVideoEditDialog() {
  const modal = document.getElementById("video-edit-modal");
  if (modal) modal.hidden = true;
  videoEditKeys = [];
  const err = document.getElementById("video-edit-error");
  if (err) err.textContent = "";
}

function renderVideoEditFiles() {
  const list = document.getElementById("video-edit-files");
  if (!list) return;
  list.innerHTML = videoEditKeys.map((key, index) => {
    const name = escapeHtml(key.split("/").pop() || key);
    const up = index === 0 ? "" : `<button type="button" onclick="moveVideoEditFile(${index}, -1)">Up</button>`;
    const down = index === videoEditKeys.length - 1 ? "" : `<button type="button" onclick="moveVideoEditFile(${index}, 1)">Down</button>`;
    return `<li><span>${name}</span> ${up} ${down}</li>`;
  }).join("");
}

function openVideoEditDialog(kind, keys, marked = {}) {
  videoEditKeys = keys.filter(isMineMp4Key);
  const modal = document.getElementById("video-edit-modal");
  const title = document.getElementById("video-edit-title");
  const times = document.getElementById("video-edit-times");
  const files = document.getElementById("video-edit-files");
  const name = document.getElementById("video-edit-name");
  const start = document.getElementById("video-edit-start");
  const end = document.getElementById("video-edit-end");
  const note = document.getElementById("video-edit-note");
  if (!modal || !name) return;
  if (title) title.textContent = kind === "combine" ? "Combine videos" : "Clip video";
  if (times) times.hidden = kind !== "clip";
  if (files) files.hidden = kind !== "combine";
  if (note) {
    note.textContent = kind === "combine"
      ? "The new MP4 plays in this order. Originals stay where they are."
      : "The new MP4 is saved in this folder. The original stays where it is.";
  }
  if (start) start.value = marked.start || "";
  if (end) end.value = marked.end || "";
  name.value = suggestEditName(kind, videoEditKeys[0]);
  modal.dataset.kind = kind;
  const err = document.getElementById("video-edit-error");
  if (err) err.textContent = "";
  if (kind === "combine") renderVideoEditFiles();
  modal.hidden = false;
  const focusTimes = kind === "clip" && !marked.start;
  (focusTimes ? start : name)?.focus();
}

window.toggleVideoCombine = function () {
  if (!showVideoEditControls(currentTab, currentPrefix, currentUserId, videoConvertOn)) return;
  videoCombineMode = !videoCombineMode;
  if (!videoCombineMode) combinePrefillKeys.clear();
  if (videoCombineMode && downloadMode) {
    downloadMode = false;
    const checkAll = document.getElementById("check-all-btn");
    const downloadSelected = document.getElementById("download-selected-btn");
    if (checkAll) checkAll.style.display = "none";
    if (downloadSelected) downloadSelected.style.display = "none";
  }
  closeVideosMenus();
  syncVideoEditControls();
  loadFiles(currentPrefix);
};

window.startCombineWith = function (encodedKey) {
  const key = decodeURIComponent(encodedKey || "");
  if (!isMineMp4Key(key) || !showVideoEditControls(currentTab, currentPrefix, currentUserId, videoConvertOn)) return;
  closeVideosMenus();
  if (downloadMode) {
    downloadMode = false;
    const checkAll = document.getElementById("check-all-btn");
    const downloadSelected = document.getElementById("download-selected-btn");
    if (checkAll) checkAll.style.display = "none";
    if (downloadSelected) downloadSelected.style.display = "none";
    document.getElementById("download-mode-btn").textContent = "⬇ Download";
  }
  videoCombineMode = true;
  combinePrefillKeys.add(key);
  syncVideoEditControls();
  loadFiles(currentPrefix);
};

function closeVideosMenus() {
  const list = document.getElementById("videos-add-list");
  if (list) list.hidden = true;
  document.getElementById("videos-add-btn")?.setAttribute("aria-expanded", "false");
  document.querySelectorAll(".file-menu-list").forEach((el) => { el.hidden = true; });
  document.querySelectorAll(".file-menu-toggle").forEach((el) => { el.setAttribute("aria-expanded", "false"); });
}
window.closeVideosMenus = closeVideosMenus;

window.toggleVideosAddMenu = function (event) {
  event?.stopPropagation();
  const list = document.getElementById("videos-add-list");
  const btn = document.getElementById("videos-add-btn");
  if (!list) return;
  const open = list.hidden;
  closeVideosMenus();
  if (open) {
    list.hidden = false;
    btn?.setAttribute("aria-expanded", "true");
  }
};

window.toggleFileMenu = function (event, encodedKey) {
  event?.preventDefault();
  event?.stopPropagation();
  const list = typeof CSS !== "undefined" && CSS.escape
    ? document.querySelector(`.file-menu-list[data-key="${CSS.escape(encodedKey)}"]`)
    : document.querySelector(`.file-menu-list[data-key="${encodedKey.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
  const btn = event?.currentTarget;
  if (!list) return;
  const open = list.hidden;
  closeVideosMenus();
  if (open) {
    list.hidden = false;
    btn?.setAttribute("aria-expanded", "true");
  }
};

window.openClipFromMenu = function (encodedKey) {
  closeVideosMenus();
  openClipDialog(encodedKey);
};

window.renameFromMenu = function (encodedKey) {
  closeVideosMenus();
  window.renamePrivateFile(encodedKey);
};

window.renameFolderFromMenu = function (encodedKey) {
  closeVideosMenus();
  window.renamePrivateFolder(encodedKey);
};

window.emptyFolderFromMenu = function (encodedKey, encodedName) {
  closeVideosMenus();
  window.handleEmptyFolder(encodedKey, decodeURIComponent(encodedName || ""));
};

window.removeFolderFromMenu = function (encodedKey, encodedName) {
  closeVideosMenus();
  window.handleRemoveFolder(encodedKey, decodeURIComponent(encodedName || ""));
};

window.runLibraryAddAction = function (action) {
  closeVideosMenus();
  if (action === "video") window.startVideoUpload();
  else if (action === "disc") window.startDiscUpload();
  else if (action === "file") {
    const area = document.getElementById("upload-area");
    if (!area || area.style.display === "none") window.toggleUpload();
  } else if (action === "folder") window.handleCreateFolder();
};

window.removeFromMenu = function (encodedKey, encodedName) {
  closeVideosMenus();
  window.handleDeleteFile(encodedKey, decodeURIComponent(encodedName || ""));
};

window.openCombineDialog = function () {
  const keys = [...document.querySelectorAll(".video-combine-checkbox:checked")].map((box) => decodeURIComponent(box.dataset.key || ""));
  if (keys.length < 2) {
    alert("Choose at least two MP4s.");
    return;
  }
  openVideoEditDialog("combine", keys);
};

window.openClipDialog = function (encodedKey, start = "", end = "") {
  const key = decodeURIComponent(encodedKey || "");
  if (!isMineMp4Key(key)) return;
  openVideoEditDialog("clip", [key], { start, end });
};

window.moveVideoEditFile = function (index, delta) {
  const next = index + delta;
  if (next < 0 || next >= videoEditKeys.length) return;
  const [row] = videoEditKeys.splice(index, 1);
  videoEditKeys.splice(next, 0, row);
  renderVideoEditFiles();
};

window.closeVideoEdit = function () {
  closeVideoEditDialog();
};

window.saveVideoEdit = async function () {
  const modal = document.getElementById("video-edit-modal");
  const errEl = document.getElementById("video-edit-error");
  const save = document.getElementById("video-edit-save");
  const kind = modal?.dataset.kind || "";
  const name = document.getElementById("video-edit-name")?.value || "";
  let body;
  try {
    body = kind === "combine"
      ? combineRequest(videoEditKeys, name)
      : clipRequest(videoEditKeys[0], document.getElementById("video-edit-start")?.value, document.getElementById("video-edit-end")?.value, name);
  } catch (err) {
    if (errEl) errEl.textContent = err.message || "Check the form.";
    return;
  }
  if (save) save.disabled = true;
  try {
    const apiUrl = await getVideoConvertApiUrl();
    if (!apiUrl) throw new Error("Video convert is not available.");
    const created = await videoConvertPost(apiUrl, "edits", body);
    closeVideoEditDialog();
    closeInlineVideo();
    videoCombineMode = false;
    videoLocalJobs.set(created.jobId, {
      jobId: created.jobId,
      filename: created.filename || body.name,
      kind: created.kind || kind,
      status: created.status || "QUEUED",
      outputPrefix: created.outputPrefix || "",
      outputKeys: [],
    });
    currentTab = "video";
    updateTabUI();
    loadVideoJobs();
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    if (errEl) errEl.textContent = err.message || "Could not start.";
  } finally {
    if (save) save.disabled = false;
  }
};

async function videoConvertPost(apiUrl, path, body) {
  const res = await authFetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function videoMultipartHandlers(apiUrl, initiateBody) {
  return {
    initiate: async ({ contentType }) => videoConvertPost(apiUrl, "uploads", { ...initiateBody, contentType }),
    signPart: async ({ key, uploadId, partNumber }) => (
      videoConvertPost(apiUrl, "uploads/parts", { key, uploadId, partNumber })
    ),
    complete: async ({ key, uploadId, parts }) => (
      videoConvertPost(apiUrl, "uploads/complete", { key, uploadId, parts })
    ),
    abort: async ({ key, uploadId }) => {
      await authFetch(`${apiUrl}uploads/abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, uploadId }),
      });
    },
  };
}

window.startVideoUpload = async function () {
  if (!(await syncVideoConvertUi())) return;
  if (!(await ensureSignedIn())) { handleSessionExpired(); return; }
  document.getElementById("video-upload-input")?.click();
};

window.startDiscUpload = async function () {
  if (!(await syncVideoConvertUi())) return;
  if (!(await ensureSignedIn())) { handleSessionExpired(); return; }
  document.getElementById("disc-upload-input")?.click();
};

async function uploadVideoFile(file) {
  if (!file) return;
  const uploadArea = document.getElementById("upload-area");
  if (uploadArea) uploadArea.style.display = "none";
  openVideoStatusTab();
  const localId = beginLocalVideoJob(file.name, { expectedBytes: file.size, uploadedBytes: 0 });
  const apiUrl = await getVideoConvertApiUrl();
  let jobId = localId;
  await holdWakeLock();
  try {
    await putMultipart(file, {
      ...videoMultipartHandlers(apiUrl, { filename: file.name }),
      initiate: async ({ contentType }) => {
        const data = await videoConvertPost(apiUrl, "uploads", { filename: file.name, contentType });
        jobId = data.jobId || localId;
        adoptVideoJob(localId, jobId, file.name);
        return data;
      },
    }, {
      contentType: file.type || "application/octet-stream",
      onProgress: (part, total, info) => {
        const row = videoLocalJobs.get(jobId);
        if (!row) return;
        row.status = "UPLOADING";
        row.expectedBytes = file.size;
        row.uploadedBytes = Number(info?.uploadedBytes) || 0;
        row.progress = `part ${part} of ${total}`;
        renderVideoJobs();
      },
    });
    const row = videoLocalJobs.get(jobId);
    if (row) {
      row.status = "CONVERTING";
      row.progress = "";
      row.uploadedBytes = file.size;
      row.expectedBytes = file.size;
    }
    renderVideoJobs();
    loadVideoJobs();
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    failLocalVideoJob(jobId, localId, err);
  } finally {
    await releaseWakeLock();
  }
}

async function uploadDiscFolder(fileList) {
  let collected;
  try {
    collected = collectConvertFolder(fileList);
  } catch (err) {
    openVideoStatusTab();
    const localId = beginLocalVideoJob("Convert folder");
    failLocalVideoJob(localId, localId, err);
    return;
  }
  const { name, files } = collected;
  const expectedBytes = files.reduce((n, row) => n + Number(row.file.size || 0), 0);
  const uploadArea = document.getElementById("upload-area");
  if (uploadArea) uploadArea.style.display = "none";
  openVideoStatusTab();
  const localId = beginLocalVideoJob(name, { expectedBytes, uploadedBytes: 0 });
  const apiUrl = await getVideoConvertApiUrl();
  let jobId = localId;
  await holdWakeLock();
  try {
    const created = await videoConvertPost(apiUrl, "uploads", { kind: collected.kind === "audio" ? "audio" : "disc", name });
    jobId = created.jobId || localId;
    adoptVideoJob(localId, jobId, name);
    const totalFiles = files.length;
    let completedBytes = 0;
    for (let i = 0; i < totalFiles; i++) {
      const { file, relativePath } = files[i];
      const row = videoLocalJobs.get(jobId);
      if (row) {
        row.status = "UPLOADING";
        row.expectedBytes = expectedBytes;
        row.uploadedBytes = completedBytes;
        row.progress = `file ${i + 1} of ${totalFiles} · ${relativePath}`;
        renderVideoJobs();
      }
      let uploaded = false;
      let lastErr;
      for (let attempt = 1; attempt <= 3 && !uploaded; attempt++) {
        try {
          await putMultipart(file, videoMultipartHandlers(apiUrl, { jobId, relativePath }), {
            contentType: file.type || "application/octet-stream",
            onProgress: (part, total, info) => {
              const current = videoLocalJobs.get(jobId);
              if (!current) return;
              const retry = attempt > 1 ? ` · retry ${attempt}` : "";
              current.status = "UPLOADING";
              current.expectedBytes = expectedBytes;
              current.uploadedBytes = completedBytes + (Number(info?.uploadedBytes) || 0);
              current.progress = `file ${i + 1} of ${totalFiles} · ${relativePath} · part ${part} of ${total}${retry}`;
              renderVideoJobs();
            },
          });
          uploaded = true;
        } catch (err) {
          lastErr = err;
          if (attempt < 3) {
            const current = videoLocalJobs.get(jobId);
            if (current) {
              current.status = "UPLOADING";
              current.uploadedBytes = completedBytes;
              current.progress = `file ${i + 1} of ${totalFiles} · retrying ${relativePath}`;
              renderVideoJobs();
            }
          }
        }
      }
      if (!uploaded) throw lastErr;
      completedBytes += Number(file.size || 0);
      const doneRow = videoLocalJobs.get(jobId);
      if (doneRow) doneRow.uploadedBytes = completedBytes;
    }
    await videoConvertPost(apiUrl, "uploads/ready", { jobId });
    const row = videoLocalJobs.get(jobId);
    if (row) {
      row.status = "CONVERTING";
      row.progress = "";
      row.uploadedBytes = expectedBytes;
      row.expectedBytes = expectedBytes;
    }
    renderVideoJobs();
    loadVideoJobs();
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    failLocalVideoJob(jobId, localId, err);
  } finally {
    await releaseWakeLock();
  }
}

// ── Upload ────────────────────────────────────────────────────────────────────
window.toggleUpload = function () {
  if (!showFileUploadButton(currentTab, currentPrefix, currentUserId)) return;
  const area   = document.getElementById("upload-area");
  const isHidden = area.style.display === "none";
  area.style.display = isHidden ? "block" : "none";
  if (isHidden) {
    const input = document.getElementById("upload-input");
    const btn   = area.querySelector("button");
    input.value = "";
    if (btn) btn.disabled = true;
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("upload-input");
  if (input) {
    const btn = document.getElementById("upload-area")?.querySelector("button");
    if (btn) btn.disabled = true;
    input.addEventListener("change", () => { if (btn) btn.disabled = !input.files.length; });
  }

  const videoInput = document.getElementById("video-upload-input");
  if (videoInput) {
    videoInput.addEventListener("change", async () => {
      const file = videoInput.files?.[0];
      videoInput.value = "";
      if (file) await uploadVideoFile(file);
    });
  }

  const discInput = document.getElementById("disc-upload-input");
  if (discInput) {
    discInput.setAttribute("webkitdirectory", "");
    discInput.setAttribute("directory", "");
    discInput.multiple = true;
    discInput.addEventListener("change", async () => {
      const files = snapshotFileList(discInput.files);
      discInput.value = "";
      if (files.length) await uploadDiscFolder(files);
    });
  }

  const captionText = document.getElementById("private-caption-text");
  if (captionText) {
    captionText.addEventListener("blur", () => { flushCaptionIfDirty(); });
  }
  wireFileListSwipeDelete();
  bindPrivatePhotoSwipes();
  document.addEventListener("click", (e) => {
    if (e.target.closest(".toolbar-menu, .file-menu")) return;
    closeVideosMenus();
  });

  const dropZone = document.getElementById("drop-zone");
  if (dropZone) {
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "#1e3a5f";
      dropZone.style.background  = "#eef3f8";
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.style.borderColor = "#b0bec5";
      dropZone.style.background  = "#f8fafc";
    });
    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "#b0bec5";
      dropZone.style.background  = "#f8fafc";
      for (const file of Array.from(e.dataTransfer.files)) {
        await handleUpload(file);
      }
    });
  }
});

window.handleUpload = async function (overrideFile = null) {
  const input    = document.getElementById("upload-input");
  const statusEl = document.getElementById("upload-status");
  const file     = overrideFile ?? input.files[0];
  if (!file) { statusEl.textContent = "Please select a file first."; return; }

  const blocked = musicDirectUploadError(currentTab, currentPrefix, currentUserId, file.name);
  if (blocked) {
    statusEl.textContent = blocked;
    statusEl.style.color = "red";
    return;
  }

  const key = currentPrefix ? `${currentPrefix}${file.name}` : file.name;
  statusEl.textContent = "Uploading…";
  statusEl.style.color = "#555";

  try {
    const apiUrl = await getDropboxApiUrl();
    const res = await authFetch(`${apiUrl}files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, contentType: file.type || "application/octet-stream" }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { url } = await res.json();
    const uploadRes = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!uploadRes.ok) throw new Error(`Upload failed: HTTP ${uploadRes.status}`);
    statusEl.textContent = `✅ ${file.name} uploaded.`;
    statusEl.style.color = "green";
    input.value = "";
    setTimeout(() => {
      statusEl.textContent = "";
      document.getElementById("upload-area").style.display = "none";
      loadFiles(currentPrefix);
    }, 2000);
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    statusEl.textContent = `❌ ${err.message}`;
    statusEl.style.color = "red";
  }
};

// ── Create Folder ─────────────────────────────────────────────────────────────
window.handleCreateFolder = async function () {
  const raw = prompt("New folder name:");
  if (raw === null) return;
  const name = raw.trim().replace(/\/+/g, "");
  if (!name) { alert("Folder name cannot be empty."); return; }
  const key = currentPrefix ? `${currentPrefix}${name}/` : `${name}/`;
  await withListOpProgress("Creating folder", async () => {
    try {
      const apiUrl = await getDropboxApiUrl();
      const res = await authFetch(`${apiUrl}files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, contentType: "application/x-directory" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { url } = await res.json();
      const uploadRes = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/x-directory" }, body: "" });
      if (!uploadRes.ok) throw new Error(`HTTP ${uploadRes.status}`);
      await reloadFilesAfterOp();
    } catch (err) {
      if (isAuthError(err)) { handleSessionExpired(); return; }
      alert("Could not create folder: " + err.message);
    }
  });
};

// ── Sign In / Out ─────────────────────────────────────────────────────────────
window.handleSignIn = async function () {
  const email    = document.getElementById("private-email").value.trim();
  const password = document.getElementById("private-password").value;
  const errEl    = document.getElementById("private-error");
  errEl.textContent = "";
  setPrivateView("loading");
  try {
    await signIn(email, password);
    await showFileBrowser();
  } catch (err) {
    showLoginForm();
    errEl.textContent = err.message ?? "Sign in failed.";
  }
};

window.handleSignOut = async function () {
  stopPlayer();
  stopVideoPoll();
  closePrivateSlideshow();
  closePrivateCaptions();
  await signOut();
  showLoginForm();
};

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function renderBreadcrumb(prefix) {
  const el = document.getElementById("private-breadcrumb");
  if (currentTab === "mine") {
    const myRoot    = `users/${currentUserId}/`;
    const subPrefix = prefix.startsWith(myRoot) ? prefix.slice(myRoot.length) : "";
    if (!subPrefix) { el.innerHTML = ""; return; }
    let html  = `<a href="#" onclick="switchTab('mine'); return false;">${currentUserLabel}</a>`;
    let built = myRoot;
    for (const part of subPrefix.split("/").filter(Boolean)) {
      built += part + "/";
      const p = built;
      html += ` / <a href="#" onclick="navigateTo('${encodeURIComponent(p)}'); return false;">${part}</a>`;
    }
    el.innerHTML = html;
    return;
  }
  const parts = prefix ? prefix.split("/").filter(Boolean) : [];
  let html  = `<a href="#" onclick="navigateTo(''); return false;">Home</a>`;
  let built = "";
  for (const part of parts) {
    built += part + "/";
    const p = built;
    html += ` / <a href="#" onclick="navigateTo('${encodeURIComponent(p)}'); return false;">${part}</a>`;
  }
  el.innerHTML = html;
}

window.navigateUp = function () {
  const parent = parentPrefix(currentPrefix);
  if (parent !== null) loadFiles(parent);
};

window.navigateTo = function (encodedPrefix) {
  loadFiles(decodeURIComponent(encodedPrefix));
};

// ── File listing ──────────────────────────────────────────────────────────────
async function loadFiles(prefix, { keepVisibleList = false, skipRenderWhen = null } = {}) {
  const gen = ++filesLoadGen;
  currentPrefix = prefix;
  renderBreadcrumb(prefix);
  updateUpButton(prefix);
  syncUploadButtons();
  const listEl = document.getElementById("private-file-list");
  if (!keepVisibleList) {
    listEl.innerHTML = `<li class="file-loading">${loadingHtml("Loading")}</li>`;
  }

  try {
    const apiUrl = await getDropboxApiUrl();
    const bust = `_=${Date.now()}-${gen}`;
    const url    = prefix
      ? `${apiUrl}files?prefix=${encodeURIComponent(prefix)}&${bust}`
      : `${apiUrl}files?${bust}`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let { folders, files } = await res.json();
    if (gen !== filesLoadGen) return null;

    if (currentTab === "shared") folders = folders.filter((f) => f.key !== "users/");
    folders = [...folders].sort((a, b) => compareLibraryFolders(a.key, b.key, prefix));
    const hadCaptionsFile = (files || []).some((f) => isCaptionsSidecar(f.key));
    files = (files || []).filter((f) => !isCaptionsSidecar(f.key));
    if (!hadCaptionsFile && captionsCache.prefix === prefix) {
      captionsCache = { prefix, map: {} };
    }

    if (typeof skipRenderWhen === "function" && skipRenderWhen(files, folders)) {
      return { folders, files };
    }

    const hasFiles = files.length > 0;
    document.getElementById("download-mode-btn").style.display = hasFiles ? "inline-block" : "none";
    if (!hasFiles && downloadMode) {
      downloadMode = false;
      document.getElementById("check-all-btn").style.display      = "none";
      document.getElementById("download-selected-btn").style.display = "none";
    }

    if (!folders.length && !files.length) {
      listEl.innerHTML = "<li>No files found.</li>";
      return { folders, files };
    }

    const mp3Files = files.filter((f) => f.key.toLowerCase().endsWith(".mp3"));
    const hasMp3   = mp3Files.length > 0;
    const mp3Html  = hasMp3 ? `
      <li class="mp3-controls" style="list-style:none; padding:0.4rem 0; border-bottom:1px solid #eee; display:flex; gap:0.5rem;">
        <button onclick="startPlaylist(false)" style="font-size:0.85rem;">▶ Play All</button>
        <button onclick="startPlaylist(true)"  style="font-size:0.85rem;">🔀 Shuffle</button>
        <span style="font-size:0.8rem; color:#888; align-self:center;">${mp3Files.length} track${mp3Files.length !== 1 ? "s" : ""}</span>
      </li>` : "";

    const imageFiles = sortImageFiles(files.filter((f) => isImageKey(f.key)));
    const hasImages = imageFiles.length > 0;
    const imageHtml = hasImages ? `
      <li class="image-controls" style="list-style:none; padding:0.4rem 0; border-bottom:1px solid #eee; display:flex; gap:0.5rem; flex-wrap:wrap;">
        <button onclick="startImageSlideshow(false)">▶ Play</button>
        <span style="font-size:0.8rem; color:#888; align-self:center;">${imageFiles.length} photo${imageFiles.length !== 1 ? "s" : ""}</span>
      </li>` : "";

    const folderHtml = folders.map((f) => {
      const name = f.key.replace(prefix, "").replace("/", "");
      const reserved = isReservedSharedTopFolder(f.key);
      const folderEnc = encodeURIComponent(f.key);
      const folderItems = [];
      if (!downloadMode && showFolderRenameButton(currentTab, f.key, currentUserId)) folderItems.push("Rename");
      if (!f.hasSubFolders && f.hasFiles) folderItems.push("Empty");
      else if (!f.hasSubFolders && !reserved) folderItems.push("Remove");
      const folderMenu = folderItems.length
        ? `<div class="file-menu">
            <button type="button" class="file-menu-toggle" aria-haspopup="true" aria-expanded="false" aria-label="Folder" onclick="toggleFileMenu(event, '${folderEnc}')">⋯</button>
            <div class="file-menu-list" data-key="${folderEnc}" hidden>
              ${folderItems.includes("Rename") ? `<button type="button" onclick="renameFolderFromMenu('${folderEnc}')">Rename</button>` : ""}
              ${folderItems.includes("Empty") ? `<button type="button" onclick="emptyFolderFromMenu('${folderEnc}','${encodeURIComponent(name)}')">Empty</button>` : ""}
              ${folderItems.includes("Remove") ? `<button type="button" onclick="removeFolderFromMenu('${folderEnc}','${encodeURIComponent(name)}')">Remove</button>` : ""}
            </div>
          </div>`
        : "";
      return `<li class="folder-item">
        <a href="#" onclick="navigateTo('${encodeURIComponent(f.key)}'); return false;">📁 ${name}</a>
        ${folderMenu ? `<div class="file-item-meta">${folderMenu}</div>` : ""}
      </li>`;
    });

    const showEdit = showVideoEditControls(currentTab, currentPrefix, currentUserId, videoConvertOn);
    const useFileMenu = showLibraryFileMenu(currentTab, currentPrefix, currentUserId);
    const listingLib = listingLibrary(currentTab, currentPrefix, currentUserId);
    const fileHtml = files.map((f) => {
      const name    = f.key.split("/").pop();
      const size    = formatFileSize(f.size);
      const isMp3   = isPlayableAudioKey(f.key);
      const isImage = isImageKey(f.key);
      const showLength = isPlayableVideoKey(f.key) || isMp3;
      const cachedLen = showLength ? mediaLengthCache.get(f.key) : null;
      const lengthHtml = showLength
        ? `<span class="file-length" data-key="${encodeURIComponent(f.key)}">${cachedLen == null ? "" : formatMediaLength(cachedLen)}</span>`
        : "";
      const canEdit = showEdit && isMineMp4Key(f.key);
      const checkbox = downloadMode ? `<input type="checkbox" class="file-checkbox" data-key="${f.key}" style="margin-right:0.4rem; cursor:pointer;" />` : "";
      const combineCheck = videoCombineMode && canEdit
        ? `<input type="checkbox" class="video-combine-checkbox" data-key="${encodeURIComponent(f.key)}"${combinePrefillKeys.has(f.key) ? " checked" : ""} aria-label="Include ${escapeHtml(name)}" />`
        : "";
      const enc = encodeURIComponent(f.key);
      const menuItems = useFileMenu ? libraryFileMenuItems({
        library: listingLib,
        convertOn: videoConvertOn,
        isMp4: isMineMp4Key(f.key),
        downloadMode,
        combineMode: videoCombineMode,
        canEdit,
      }) : (!downloadMode && !videoCombineMode ? ["Rename"] : []);
      const fileMenu = menuItems.length
        ? `<div class="file-menu">
            <button type="button" class="file-menu-toggle" aria-haspopup="true" aria-expanded="false" aria-label="File" onclick="toggleFileMenu(event, '${enc}')">⋯</button>
            <div class="file-menu-list" data-key="${enc}" hidden>
              ${menuItems.includes("Clip") ? `<button type="button" onclick="openClipFromMenu('${enc}')">Clip</button>` : ""}
              ${menuItems.includes("Rename") ? `<button type="button" onclick="renameFromMenu('${enc}')">Rename</button>` : ""}
              ${menuItems.includes("Combine") ? `<button type="button" onclick="startCombineWith('${enc}')">Combine</button>` : ""}
              ${menuItems.includes("Remove") ? `<button type="button" onclick="removeFromMenu('${enc}','${encodeURIComponent(name)}')">Remove</button>` : ""}
            </div>
          </div>`
        : "";
      const icon = isImage ? "🖼" : isMp3 ? "🎵" : isPlayableVideoKey(f.key) ? "🎬" : "📄";
      const openAction = isImage
        ? `startImageSlideshowAt('${enc}')`
        : `openFile('${enc}')`;
      return `<li class="file-item" data-key="${enc}" data-name="${encodeURIComponent(name)}">
        ${checkbox}${combineCheck}
        <a href="#" onclick="${openAction}; return false;">${icon} ${name}</a>
        <div class="file-item-meta">
          ${fileMenu}
          ${lengthHtml}
          <span class="file-size">${size}</span>
        </div>
      </li>`;
    });

    listEl.innerHTML = imageHtml + mp3Html + [...folderHtml, ...fileHtml].join("");
    fillFileMediaLengths(files, gen);
    window._currentMp3Keys = mp3Files.map((f) => f.key);
    window._currentImageKeys = imageFiles.map((f) => f.key);
    if (hasImages) {
      loadCaptionsMap(prefix).then((map) => {
        window._currentCaptions = map;
        if (isPrivateSlideshowOpen()) {
          const key = slideKeys[slideIndex];
          const status = document.getElementById("private-slide-status");
          if (status && key) status.textContent = captionForKey(key) || fileNameFromKey(key);
        }
      }).catch((err) => {
        if (isAuthError(err)) handleSessionExpired();
      });
    } else if (captionsCache.prefix === prefix) {
      window._currentCaptions = captionsCache.map;
    } else {
      window._currentCaptions = {};
    }

    return { folders, files };
  } catch (err) {
    if (gen !== filesLoadGen) return null;
    if (isAuthError(err)) { handleSessionExpired(); return null; }
    if (!keepVisibleList) {
      listEl.innerHTML = `<li style="color:red">Error: ${err.message}</li>`;
    }
    return null;
  }
}

window.openFile = async function (encodedKey) {
  const key = decodeURIComponent(encodedKey || "");
  if (isPlayableAudioKey(key)) {
    playSingleTrack(encodedKey);
    return;
  }
  if (isPlayableVideoKey(key)) {
    playInlineVideo(key);
    return;
  }
  try {
    const apiUrl = await getDropboxApiUrl();
    const res = await authFetch(`${apiUrl}files/${encodedKey}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { url } = await res.json();
    window.open(url, "_blank");
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    alert("Could not open file: " + err.message);
  }
};

// ── Audio player ──────────────────────────────────────────────────────────────
async function getPresignedUrl(key) {
  const apiUrl = await getDropboxApiUrl();
  const res = await authFetch(`${apiUrl}files/${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { url } = await res.json();
  return url;
}

function captionForKey(key) {
  const name = fileNameFromKey(key);
  const text = (window._currentCaptions || captionsCache.map || {})[name];
  return typeof text === "string" ? text.trim() : "";
}

function parseCaptionsPayload(data) {
  const raw = data && typeof data === "object" && data.captions && typeof data.captions === "object"
    ? data.captions
    : (data && typeof data === "object" && !data.version ? data : {});
  const map = {};
  for (const [name, text] of Object.entries(raw)) {
    if (typeof text === "string" && text.trim()) map[name] = text;
  }
  return map;
}

async function loadCaptionsMap(prefix) {
  if (captionsCache.prefix === prefix) return { ...captionsCache.map };
  const key = captionsKeyForPrefix(prefix);
  try {
    const url = await getPresignedUrl(key);
    const res = await fetch(url);
    if (!res.ok) {
      captionsCache = { prefix, map: {} };
      return {};
    }
    const data = await res.json();
    const map = parseCaptionsPayload(data);
    captionsCache = { prefix, map };
    return { ...map };
  } catch (err) {
    if (isAuthError(err)) throw err;
    captionsCache = { prefix, map: {} };
    return {};
  }
}

async function saveCaptionsMap(prefix, map, imageKeys) {
  const names = new Set((imageKeys || []).map(fileNameFromKey));
  const pruned = {};
  for (const [name, text] of Object.entries(map || {})) {
    if (names.size && !names.has(name)) continue;
    const trimmed = String(text ?? "").trim();
    if (trimmed) pruned[name] = trimmed;
  }
  const body = JSON.stringify({ version: 1, captions: pruned });
  const key = captionsKeyForPrefix(prefix);
  const apiUrl = await getDropboxApiUrl();
  const res = await authFetch(`${apiUrl}files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, contentType: "application/json" }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { url } = await res.json();
  const uploadRes = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!uploadRes.ok) throw new Error(`Save failed: HTTP ${uploadRes.status}`);
  captionsCache = { prefix, map: { ...pruned } };
  if (prefix === currentPrefix) window._currentCaptions = { ...pruned };
}

async function listImageKeysForPrefix(prefix) {
  if (prefix === currentPrefix && Array.isArray(window._currentImageKeys) && window._currentImageKeys.length) {
    return [...window._currentImageKeys];
  }
  const apiUrl = await getDropboxApiUrl();
  const url = prefix
    ? `${apiUrl}files?prefix=${encodeURIComponent(prefix)}`
    : `${apiUrl}files`;
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const files = (data.files || []).filter((f) => !isCaptionsSidecar(f.key) && isImageKey(f.key));
  return sortImageFiles(files).map((f) => f.key);
}

function setCaptionSaveStatus(text) {
  const el = document.getElementById("private-caption-save-status");
  if (!el) return;
  if (text === "Loading…") {
    el.innerHTML = loadingHtml("Loading", { dark: true });
    return;
  }
  el.textContent = text || "";
}

function isPrivateCaptionsOpen() {
  return document.getElementById("private-captions")?.classList.contains("is-open");
}

function currentCaptionName() {
  return fileNameFromKey(captionKeys[captionIndex] || "");
}

let captionFlushTail = Promise.resolve();

function flushCaptionIfDirty() {
  captionFlushTail = captionFlushTail.then(runFlushCaption, runFlushCaption);
  return captionFlushTail;
}

async function savePrivateCaption() {
  await flushCaptionIfDirty();
  const el = document.getElementById("private-caption-save-status");
  if (el && !el.textContent) setCaptionSaveStatus("Saved");
}

async function runFlushCaption() {
  const name = currentCaptionName();
  if (!name || !isPrivateCaptionsOpen()) return;
  const textarea = document.getElementById("private-caption-text");
  const next = textarea ? textarea.value : "";
  const prev = captionMap[name] || "";
  if (next === prev) return;
  captionMap[name] = next;
  setCaptionSaveStatus("Saving…");
  try {
    await saveCaptionsMap(captionPrefix, captionMap, captionKeys);
    captionMap = { ...captionsCache.map };
    if (textarea && currentCaptionName() === name) textarea.value = captionMap[name] || "";
    setCaptionSaveStatus("Saved");
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    setCaptionSaveStatus(`Could not save: ${err.message}`);
  }
}

async function showCaptionPhoto(index) {
  if (!captionKeys.length) return;
  captionIndex = Math.max(0, Math.min(index, captionKeys.length - 1));
  const key = captionKeys[captionIndex];
  const name = fileNameFromKey(key);
  const img = document.getElementById("private-caption-img");
  const nameEl = document.getElementById("private-caption-name");
  const textarea = document.getElementById("private-caption-text");
  const count = document.getElementById("private-caption-count");
  if (nameEl) nameEl.textContent = name;
  if (count) count.textContent = `${captionIndex + 1} / ${captionKeys.length}`;
  if (textarea) textarea.value = captionMap[name] || "";
  if (img) img.style.opacity = "0.35";

  const ticket = ++captionLoadTicket;
  try {
    const url = await getPresignedUrl(key);
    if (ticket !== captionLoadTicket) return;
    if (!img) return;
    img.onload = () => {
      if (ticket !== captionLoadTicket) return;
      img.style.opacity = "1";
    };
    img.onerror = () => {
      if (ticket !== captionLoadTicket) return;
      img.style.opacity = "1";
      setCaptionSaveStatus(`Could not load ${name}`);
    };
    img.alt = name;
    img.src = url;
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    if (ticket !== captionLoadTicket) return;
    setCaptionSaveStatus(err.message);
  }
}

async function openFolderCaptions(encodedPrefix, startKey) {
  const keepSlideshow = isPrivateSlideshowOpen();
  if (keepSlideshow) {
    slidePlaying = false;
    updatePrivateSlidePlayButton();
    clearSlideTimer();
  } else {
    closePrivateSlideshow();
  }
  const prefix = encodedPrefix ? decodeURIComponent(encodedPrefix) : currentPrefix;
  setCaptionSaveStatus("Loading…");
  document.getElementById("private-captions")?.classList.add("is-open");
  try {
    const keys = await listImageKeysForPrefix(prefix);
    if (!keys.length) {
      closePrivateCaptions();
      alert("No photos in this folder.");
      return;
    }
    captionPrefix = prefix;
    captionKeys = keys;
    captionMap = await loadCaptionsMap(prefix);
    window._currentCaptions = prefix === currentPrefix ? { ...captionMap } : window._currentCaptions;
    setCaptionSaveStatus("");
    const start = startKey ? keys.indexOf(startKey) : 0;
    await showCaptionPhoto(start >= 0 ? start : 0);
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    closePrivateCaptions();
    alert("Could not open captions: " + err.message);
  }
}

async function privateCaptionPrev() {
  if (!captionKeys.length) return;
  await flushCaptionIfDirty();
  await showCaptionPhoto(captionIndex > 0 ? captionIndex - 1 : captionKeys.length - 1);
}

async function privateCaptionNext() {
  if (!captionKeys.length) return;
  await flushCaptionIfDirty();
  await showCaptionPhoto(captionIndex < captionKeys.length - 1 ? captionIndex + 1 : 0);
}

async function closePrivateCaptions() {
  if (isPrivateCaptionsOpen()) {
    await flushCaptionIfDirty();
  }
  captionLoadTicket++;
  captionKeys = [];
  captionIndex = 0;
  captionMap = {};
  captionPrefix = "";
  const overlay = document.getElementById("private-captions");
  const img = document.getElementById("private-caption-img");
  const textarea = document.getElementById("private-caption-text");
  overlay?.classList.remove("is-open");
  if (img) {
    img.removeAttribute("src");
    img.alt = "";
  }
  if (textarea) textarea.value = "";
  setCaptionSaveStatus("");
  if (isPrivateSlideshowOpen() && slideKeys[slideIndex]) {
    const key = slideKeys[slideIndex];
    const status = document.getElementById("private-slide-status");
    if (status) status.textContent = captionForKey(key) || fileNameFromKey(key);
  }
}

window.openFolderCaptions = openFolderCaptions;
window.privateCaptionPrev = privateCaptionPrev;
window.privateCaptionNext = privateCaptionNext;
window.closePrivateCaptions = closePrivateCaptions;
window.savePrivateCaption = savePrivateCaption;

const DEFAULT_SLIDESHOW_NAME = "New Slideshow Name";

function currentSlideKey() {
  return slideKeys[slideIndex] || "";
}

function pausePrivateSlideshow() {
  if (!isPrivateSlideshowOpen()) return;
  slidePlaying = false;
  updatePrivateSlidePlayButton();
  clearSlideTimer();
}

function captionCurrentSlide() {
  const key = currentSlideKey();
  if (!key) return;
  openFolderCaptions(null, key);
}

function albumPath(album) {
  const [owner, ...slugParts] = String(album?.id || "").split("/");
  const slug = album?.slug || slugParts.join("/");
  return { owner, slug };
}

let selectedExistingAlbum = null;

function closeAddToSlideshow() {
  selectedExistingAlbum = null;
  const addBtn = document.getElementById("private-add-slideshow-add");
  if (addBtn) addBtn.disabled = true;
  document.getElementById("private-add-slideshow")?.classList.remove("is-open");
}

async function showAddSlideshowThumb() {
  const thumb = document.getElementById("private-add-slideshow-thumb");
  if (!thumb) return;
  const slideImg = document.getElementById("private-slide-img");
  if (slideImg?.src) {
    thumb.src = slideImg.src;
    thumb.hidden = false;
    return;
  }
  const key = currentSlideKey();
  if (!key) {
    thumb.removeAttribute("src");
    thumb.hidden = true;
    return;
  }
  try {
    thumb.src = await getPresignedUrl(key);
    thumb.hidden = false;
  } catch {
    thumb.removeAttribute("src");
    thumb.hidden = true;
  }
}

function selectExistingAlbum(album, btn) {
  selectedExistingAlbum = album;
  document.querySelectorAll(".private-add-slideshow-item").forEach((el) => {
    el.classList.toggle("is-selected", el === btn);
  });
  const addBtn = document.getElementById("private-add-slideshow-add");
  if (addBtn) addBtn.disabled = !album;
}

async function openAddToSlideshow() {
  const key = currentSlideKey();
  if (!key) return;
  pausePrivateSlideshow();
  selectedExistingAlbum = null;
  const overlay = document.getElementById("private-add-slideshow");
  const list = document.getElementById("private-add-slideshow-list");
  const titleInput = document.getElementById("private-add-slideshow-title");
  const status = document.getElementById("private-add-slideshow-status");
  const addBtn = document.getElementById("private-add-slideshow-add");
  if (titleInput) titleInput.value = "";
  if (status) status.textContent = "";
  if (addBtn) addBtn.disabled = true;
  if (list) list.innerHTML = `<li class="file-loading">${loadingHtml("Loading")}</li>`;
  overlay?.classList.add("is-open");
  showAddSlideshowThumb();
  try {
    const apiUrl = await getDropboxApiUrl();
    const res = await authFetch(`${apiUrl}shared-albums/mine`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const albums = Array.isArray(data.albums) ? data.albums : [];
    if (!list) return;
    if (!albums.length) {
      list.innerHTML = `<li class="private-add-slideshow-empty">None yet.</li>`;
      return;
    }
    list.innerHTML = albums.map((album) => {
      const count = Number(album.photoCount) || 0;
      const title = album.title || "Slideshow";
      return `<li>
        <button type="button" class="private-add-slideshow-item" data-id="${encodeURIComponent(album.id || "")}" data-slug="${encodeURIComponent(album.slug || "")}">
          <span>${escapeHtml(title)}</span>
          <span>${count} photo${count === 1 ? "" : "s"}</span>
        </button>
      </li>`;
    }).join("");
    const buttons = [...list.querySelectorAll("button[data-id]")];
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        selectExistingAlbum({
          id: decodeURIComponent(btn.dataset.id || ""),
          slug: decodeURIComponent(btn.dataset.slug || ""),
        }, btn);
      });
    });
    if (buttons.length === 1) buttons[0].click();
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    if (list) list.innerHTML = `<li class="private-add-slideshow-empty">${escapeHtml(err.message)}</li>`;
  }
}

function addSelectedPhotoToExistingSlideshow() {
  const status = document.getElementById("private-add-slideshow-status");
  if (!selectedExistingAlbum) {
    if (status) status.textContent = "Select a slideshow.";
    return;
  }
  addCurrentPhotoToAlbum(selectedExistingAlbum);
}

async function createSlideshowWithCurrentPhoto() {
  const key = currentSlideKey();
  const titleInput = document.getElementById("private-add-slideshow-title");
  const status = document.getElementById("private-add-slideshow-status");
  const title = (titleInput?.value || DEFAULT_SLIDESHOW_NAME).trim();
  if (!key) return;
  if (!title) {
    if (status) status.textContent = "Enter a name.";
    return;
  }
  if (status) status.textContent = "Creating…";
  try {
    const apiUrl = await getDropboxApiUrl();
    const res = await authFetch(`${apiUrl}shared-albums`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keys: [key],
        title,
        ownerLabel: currentUserLabel,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    closeAddToSlideshow();
    alert(`Added Slideshow "${data.album?.title || title}"`);
    loadMySlideshows();
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    if (status) status.textContent = err.message;
  }
}

async function addCurrentPhotoToAlbum(album) {
  const key = currentSlideKey();
  const status = document.getElementById("private-add-slideshow-status");
  const { owner, slug } = albumPath(album);
  if (!key || !owner || !slug) return;
  if (status) status.textContent = "Adding…";
  try {
    const apiUrl = await getDropboxApiUrl();
    const res = await authFetch(
      `${apiUrl}shared-albums/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/photos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [key], ownerLabel: currentUserLabel }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    closeAddToSlideshow();
    const added = Array.isArray(data.added) && data.added.length;
    const name = data.album?.title || "slideshow";
    alert(added ? `Added Slideshow "${name}"` : `Already in Slideshow "${name}"`);
    loadMySlideshows();
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    if (status) status.textContent = err.message;
  }
}

let mySlideshows = [];
let expandedSlideshowId = null;

function sharedAlbumApiPath(album, extra = "") {
  const { owner, slug } = albumPath(album);
  if (!owner || !slug) return "";
  const base = `shared-albums/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`;
  return extra ? `${base}/${extra}` : base;
}

async function loadMySlideshows() {
  const list = document.getElementById("private-slideshows-list");
  const status = document.getElementById("private-slideshows-status");
  if (!list) return;
  if (status) status.textContent = "";
  list.innerHTML = `<li class="file-loading">${loadingHtml("Loading")}</li>`;
  try {
    const apiUrl = await getDropboxApiUrl();
    const res = await authFetch(`${apiUrl}shared-albums/mine`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    mySlideshows = Array.isArray(data.albums) ? data.albums : [];
    renderMySlideshows();
    if (expandedSlideshowId) await loadMySlideshowPhotos(expandedSlideshowId);
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    mySlideshows = [];
    list.innerHTML = "";
    if (status) status.textContent = err.message;
  }
}

function renderMySlideshows() {
  const list = document.getElementById("private-slideshows-list");
  const status = document.getElementById("private-slideshows-status");
  if (!list) return;
  if (!mySlideshows.length) {
    list.innerHTML = "";
    if (status) status.textContent = "None yet — open a photo and use + Slideshow.";
    return;
  }
  if (status) status.textContent = "";
  list.innerHTML = mySlideshows.map((album) => {
    const id = album.id || "";
    const count = Number(album.photoCount) || 0;
    const title = album.title || "Slideshow";
    const open = id === expandedSlideshowId;
    return `<li data-id="${encodeURIComponent(id)}">
      <div class="private-slideshow-album-row">
        <button type="button" class="private-slideshow-album-toggle" data-toggle="${encodeURIComponent(id)}">
          ${escapeHtml(title)} <span class="private-slideshow-album-meta">· ${count} photo${count === 1 ? "" : "s"}</span>
        </button>
        <button type="button" class="folder-action-btn" data-remove-album="${encodeURIComponent(id)}">Remove slideshow</button>
      </div>
      <ul class="private-slideshow-photos" ${open ? "" : "hidden"} data-photos="${encodeURIComponent(id)}"></ul>
    </li>`;
  }).join("");
  list.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggleMySlideshow(decodeURIComponent(btn.dataset.toggle || "")));
  });
  list.querySelectorAll("[data-remove-album]").forEach((btn) => {
    btn.addEventListener("click", () => removeMySlideshow(decodeURIComponent(btn.dataset.removeAlbum || "")));
  });
}

async function toggleMySlideshow(id) {
  expandedSlideshowId = expandedSlideshowId === id ? null : id;
  renderMySlideshows();
  if (expandedSlideshowId) await loadMySlideshowPhotos(expandedSlideshowId);
}

async function loadMySlideshowPhotos(id) {
  const album = mySlideshows.find((a) => a.id === id);
  const encodedId = encodeURIComponent(id);
  const photosEl = document.querySelector(`[data-photos="${encodedId}"]`);
  if (!album || !photosEl) return;
  photosEl.hidden = false;
  photosEl.innerHTML = `<li class="file-loading">${loadingHtml("Loading")}</li>`;
  try {
    const apiUrl = await getDropboxApiUrl();
    const path = sharedAlbumApiPath(album);
    const res = await authFetch(`${apiUrl}${path}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const photos = Array.isArray(data.photos) ? data.photos : [];
    if (!photos.length) {
      photosEl.innerHTML = `<li class="private-add-slideshow-empty">No photos in this slideshow.</li>`;
      return;
    }
    photosEl.innerHTML = photos.map((photo) => {
      const filename = photo.filename || "";
      const caption = photo.caption || "";
      const url = photo.url || "";
      return `<li>
        <img src="${escapeHtml(url)}" alt="" />
        <div class="private-slideshow-photo-copy">
          <strong>${escapeHtml(filename)}</strong>
          <span>${escapeHtml(caption)}</span>
        </div>
        <button type="button" class="folder-action-btn" data-remove-photo="${encodeURIComponent(filename)}">Remove</button>
      </li>`;
    }).join("");
    photosEl.querySelectorAll("[data-remove-photo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removePhotoFromMySlideshow(album, decodeURIComponent(btn.dataset.removePhoto || ""));
      });
    });
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    photosEl.innerHTML = `<li class="private-add-slideshow-empty">${escapeHtml(err.message)}</li>`;
  }
}

async function removeMySlideshow(id) {
  const album = mySlideshows.find((a) => a.id === id);
  if (!album) return;
  const title = album.title || "Slideshow";
  if (!confirm(`Remove slideshow “${title}” from the public Slideshows page?`)) return;
  try {
    const apiUrl = await getDropboxApiUrl();
    const path = sharedAlbumApiPath(album);
    const res = await authFetch(`${apiUrl}${path}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (expandedSlideshowId === id) expandedSlideshowId = null;
    await loadMySlideshows();
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    alert("Could not remove slideshow: " + err.message);
  }
}

async function removePhotoFromMySlideshow(album, filename) {
  if (!album || !filename) return;
  const title = album.title || "slideshow";
  if (!confirm(`Remove “${filename}” from “${title}”?`)) return;
  try {
    const apiUrl = await getDropboxApiUrl();
    const path = sharedAlbumApiPath(album, `photos/${encodeURIComponent(filename)}`);
    const res = await authFetch(`${apiUrl}${path}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const nextCount = Number(data.album?.photoCount);
    mySlideshows = mySlideshows.map((item) => (
      item.id === album.id && Number.isFinite(nextCount) ? { ...item, photoCount: nextCount } : item
    ));
    renderMySlideshows();
    if (expandedSlideshowId === album.id) await loadMySlideshowPhotos(album.id);
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    alert("Could not remove photo: " + err.message);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

window.captionCurrentSlide = captionCurrentSlide;
window.openAddToSlideshow = openAddToSlideshow;
window.closeAddToSlideshow = closeAddToSlideshow;
window.createSlideshowWithCurrentPhoto = createSlideshowWithCurrentPhoto;
window.addSelectedPhotoToExistingSlideshow = addSelectedPhotoToExistingSlideshow;

window.startPlaylist = function (shuffle) {
  const keys = [...(window._currentMp3Keys || [])];
  if (!keys.length) return;
  if (shuffle) {
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
  }
  playlist = keys; trackIndex = 0; playTrack(0);
};

window.playSingleTrack = function (encodedKey) {
  playlist = [decodeURIComponent(encodedKey)]; trackIndex = 0; playTrack(0);
};

async function playTrack(index) {
  if (index < 0 || index >= playlist.length) { stopPlayer(); return; }
  closeInlineVideo();
  const key  = playlist[index];
  const name = key.split("/").pop();
  showPlayer(name, index, playlist.length);
  keepAppTabTitle();
  updatePlayerLoading(true);
  try {
    const url = await getPresignedUrl(key);
    if (!audio) {
      audio = new Audio();
      audio.addEventListener("ended",      () => playTrack(trackIndex + 1));
      audio.addEventListener("timeupdate", updateProgress);
      audio.addEventListener("play",       keepAppTabTitle);
      audio.addEventListener("canplay",    () => {
        keepAppTabTitle();
        updatePlayerLoading(false);
      });
    } else {
      audio.pause(); audio.src = "";
    }
    audio.src = url; trackIndex = index; audio.play();
    keepAppTabTitle();
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    document.getElementById("player-track").textContent = `Error: ${err.message}`;
    updatePlayerLoading(false);
  }
}

function showPlayer(trackName, index, total) {
  document.getElementById("audio-player").style.display = "flex";
  document.getElementById("player-track").textContent   = trackName;
  document.getElementById("player-count").textContent   = `${index + 1} / ${total}`;
  document.getElementById("player-progress").value      = 0;
}

function updatePlayerLoading(loading) {
  document.getElementById("player-track").style.opacity = loading ? "0.5" : "1";
}

function updateProgress() {
  if (!audio?.duration) return;
  document.getElementById("player-progress").value = (audio.currentTime / audio.duration) * 100;
}

function stopPlayer() {
  if (audio) { audio.pause(); audio.src = ""; }
  playlist = [];
  document.getElementById("audio-player").style.display = "none";
}

window.playerPrev  = () => { if (trackIndex > 0) playTrack(trackIndex - 1); };
window.playerNext  = () => playTrack(trackIndex + 1);
window.playerStop  = () => stopPlayer();
window.playerSeek  = (el) => { if (audio?.duration) audio.currentTime = (el.value / 100) * audio.duration; };

let inlineVideoKey = "";
let inlineClipStart = null;
let inlineClipEnd = null;

function canClipInlineVideo(key) {
  return showVideoEditControls(currentTab, currentPrefix, currentUserId, videoConvertOn) && isMineMp4Key(key);
}

function setInlineClipError(message) {
  const err = document.getElementById("inline-video-clip-error");
  if (err) err.textContent = message || "";
}

function syncInlineClipMarks() {
  const startEl = document.getElementById("inline-video-clip-start");
  const endEl = document.getElementById("inline-video-clip-end");
  if (startEl) startEl.textContent = inlineClipStart == null ? "—" : formatMediaTimestamp(inlineClipStart);
  if (endEl) endEl.textContent = inlineClipEnd == null ? "—" : formatMediaTimestamp(inlineClipEnd);
}

function resetInlineClipMarks() {
  inlineClipStart = null;
  inlineClipEnd = null;
  setInlineClipError("");
  syncInlineClipMarks();
}

function showInlineClipBar(key) {
  const bar = document.getElementById("inline-video-clip");
  if (!bar) return;
  bar.hidden = !canClipInlineVideo(key);
  resetInlineClipMarks();
}

function readInlineVideoTime() {
  const video = document.getElementById("inline-video");
  const at = Number(video?.currentTime);
  if (!video || !Number.isFinite(at)) throw new Error("Wait for the video to load.");
  formatMediaTimestamp(at);
  return at;
}

async function playInlineVideo(key) {
  stopPlayer();
  keepAppTabTitle();
  const overlay = document.getElementById("inline-video-player");
  const video = document.getElementById("inline-video");
  const nameEl = document.getElementById("inline-video-name");
  if (!overlay || !video) {
    alert("Could not play video in the page.");
    return;
  }
  inlineVideoKey = key;
  if (nameEl) nameEl.textContent = fileNameFromKey(key);
  showInlineClipBar(key);
  overlay.classList.add("is-open");
  try {
    const url = await getPresignedUrl(key);
    video.onplay = keepAppTabTitle;
    video.src = url;
    video.play().catch(() => {});
    keepAppTabTitle();
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    alert("Could not play video: " + err.message);
    closeInlineVideo();
  }
}

function closeInlineVideo() {
  const overlay = document.getElementById("inline-video-player");
  const video = document.getElementById("inline-video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  inlineVideoKey = "";
  resetInlineClipMarks();
  document.getElementById("inline-video-clip")?.setAttribute("hidden", "");
  overlay?.classList.remove("is-open");
  keepAppTabTitle();
}

window.closeInlineVideo = closeInlineVideo;

window.markInlineVideoClip = function (which) {
  setInlineClipError("");
  if (!canClipInlineVideo(inlineVideoKey)) return;
  try {
    const at = readInlineVideoTime();
    if (which === "end") inlineClipEnd = at;
    else inlineClipStart = at;
    syncInlineClipMarks();
  } catch (err) {
    setInlineClipError(err.message || "Could not mark that time.");
  }
};

window.createInlineVideoClip = function () {
  setInlineClipError("");
  if (!canClipInlineVideo(inlineVideoKey)) return;
  try {
    const marked = clipTimesFromMarks(inlineClipStart, inlineClipEnd);
    document.getElementById("inline-video")?.pause();
    openClipDialog(encodeURIComponent(inlineVideoKey), marked.start, marked.end);
  } catch (err) {
    setInlineClipError(err.message || "Mark the start and end of the clip.");
  }
};

window.skipInlineVideo = function (delta) {
  const video = document.getElementById("inline-video");
  if (!video) return;
  video.currentTime = skipMediaTime(video.currentTime, video.duration, delta);
};

// ── Folder image slideshow ────────────────────────────────────────────────────
function isPrivateSlideshowOpen() {
  return document.getElementById("private-slideshow")?.classList.contains("is-open");
}

function updatePrivateSlidePlayButton() {
  const btn = document.getElementById("private-slide-play");
  if (!btn) return;
  btn.textContent = slidePlaying ? "⏸" : "▶";
  btn.title = slidePlaying ? "Pause" : "Play";
}

function clearSlideTimer() {
  if (slideTimer) {
    clearTimeout(slideTimer);
    slideTimer = null;
  }
}

function scheduleNextPrivateSlide() {
  clearSlideTimer();
  if (!slidePlaying || slideKeys.length < 2) return;
  slideTimer = setTimeout(() => {
    if (slideIndex < slideKeys.length - 1) {
      showPrivateSlide(slideIndex + 1);
    } else {
      slidePlaying = false;
      updatePrivateSlidePlayButton();
    }
  }, SLIDE_INTERVAL_MS);
}

async function showPrivateSlide(index) {
  if (!slideKeys.length) return;
  clearSlideTimer();
  slideIndex = Math.max(0, Math.min(index, slideKeys.length - 1));
  const key  = slideKeys[slideIndex];
  const name = fileNameFromKey(key);
  const caption = captionForKey(key);
  const img    = document.getElementById("private-slide-img");
  const status = document.getElementById("private-slide-status");
  const count  = document.getElementById("private-slide-count");
  if (status) status.textContent = caption || name;
  if (count)  count.textContent = `${slideIndex + 1} / ${slideKeys.length}`;
  if (img) img.style.opacity = "0.35";

  const ticket = ++slideLoadTicket;
  try {
    const url = await getPresignedUrl(key);
    if (ticket !== slideLoadTicket) return;
    if (!img) return;
    img.onload = () => {
      if (ticket !== slideLoadTicket) return;
      img.style.opacity = "1";
      scheduleNextPrivateSlide();
    };
    img.alt = caption || name;
    img.src = url;
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    if (ticket !== slideLoadTicket) return;
    if (status) status.textContent = err.message;
    scheduleNextPrivateSlide();
  }
}

async function openPrivateSlideshow(keys, startIndex = 0, autoplay = true) {
  if (!keys.length) return;
  try {
    window._currentCaptions = await loadCaptionsMap(currentPrefix);
  } catch (err) {
    if (isAuthError(err)) { handleSessionExpired(); return; }
    window._currentCaptions = window._currentCaptions || {};
  }
  slideKeys = keys;
  slidePlaying = autoplay;
  document.getElementById("private-slideshow")?.classList.add("is-open");
  updatePrivateSlidePlayButton();
  showPrivateSlide(startIndex);
}

function startImageSlideshow(shuffle) {
  const keys = [...(window._currentImageKeys || [])];
  if (!keys.length) return;
  openPrivateSlideshow(shuffle ? shuffleKeys(keys) : keys, 0, true);
}

function startImageSlideshowAt(encodedKey) {
  const keys = [...(window._currentImageKeys || [])];
  const key  = decodeURIComponent(encodedKey);
  let index  = keys.indexOf(key);
  if (index < 0) {
    keys.unshift(key);
    index = 0;
  }
  openPrivateSlideshow(keys, index, false);
}

function togglePrivateSlidePlay() {
  if (!isPrivateSlideshowOpen() || !slideKeys.length) return;
  slidePlaying = !slidePlaying;
  updatePrivateSlidePlayButton();
  if (slidePlaying) scheduleNextPrivateSlide();
  else clearSlideTimer();
}

function privateSlidePrev() {
  if (!slideKeys.length) return;
  clearSlideTimer();
  showPrivateSlide(slideIndex > 0 ? slideIndex - 1 : slideKeys.length - 1);
}

function privateSlideNext() {
  if (!slideKeys.length) return;
  clearSlideTimer();
  showPrivateSlide(slideIndex < slideKeys.length - 1 ? slideIndex + 1 : 0);
}

function closePrivateSlideshow() {
  closeAddToSlideshow();
  slidePlaying = false;
  slideKeys = [];
  slideIndex = 0;
  slideLoadTicket++;
  clearSlideTimer();
  const overlay = document.getElementById("private-slideshow");
  const img = document.getElementById("private-slide-img");
  overlay?.classList.remove("is-open");
  if (img) {
    img.removeAttribute("src");
    img.alt = "";
  }
}

window.startImageSlideshow = startImageSlideshow;
window.startImageSlideshowAt = startImageSlideshowAt;
window.togglePrivateSlidePlay = togglePrivateSlidePlay;
window.privateSlidePrev = privateSlidePrev;
window.privateSlideNext = privateSlideNext;
window.closePrivateSlideshow = closePrivateSlideshow;

function bindPhotoViewerGestures(el, { onLeft, onRight, onDown, onDoubleTap } = {}) {
  if (!el || el.dataset.photoGesturesBound) return;
  el.dataset.photoGesturesBound = "1";
  let startX = null;
  let startY = null;
  let lastTap = 0;

  el.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) {
      startX = null;
      return;
    }
    if (e.target.closest("button, textarea, input, select, a")) {
      startX = null;
      return;
    }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  el.addEventListener("touchend", (e) => {
    if (startX == null || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    startX = null;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) {
      lastTap = 0;
      if (dx < 0) onLeft?.();
      else onRight?.();
      return;
    }
    if (dy >= 50 && Math.abs(dy) > Math.abs(dx)) {
      lastTap = 0;
      onDown?.();
      return;
    }
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
    const now = Date.now();
    if (now - lastTap < 320) {
      lastTap = 0;
      onDoubleTap?.();
    } else {
      lastTap = now;
    }
  }, { passive: true });
}

let lastTouchPhotoGestureAt = 0;

function bindPrivatePhotoSwipes() {
  const fromTouch = () => { lastTouchPhotoGestureAt = Date.now(); };
  const pauseThen = (fn) => () => {
    if (slidePlaying) {
      slidePlaying = false;
      updatePrivateSlidePlayButton();
    }
    fn();
  };
  bindPhotoViewerGestures(document.getElementById("private-slideshow"), {
    onLeft: pauseThen(privateSlideNext),
    onRight: pauseThen(privateSlidePrev),
    onDown: () => { fromTouch(); pauseThen(promptRemoveDisplayedPhoto)(); },
    onDoubleTap: () => { fromTouch(); pauseThen(promptRemoveDisplayedPhoto)(); },
  });
  bindPhotoViewerGestures(document.getElementById("private-captions"), {
    onLeft: privateCaptionNext,
    onRight: privateCaptionPrev,
    onDown: () => { fromTouch(); promptRemoveDisplayedPhoto(); },
    onDoubleTap: () => { fromTouch(); promptRemoveDisplayedPhoto(); },
  });
  for (const id of ["private-slide-img", "private-caption-img"]) {
    const img = document.getElementById(id);
    if (!img || img.dataset.dblClickBound) continue;
    img.dataset.dblClickBound = "1";
    img.addEventListener("dblclick", (e) => {
      e.preventDefault();
      if (Date.now() - lastTouchPhotoGestureAt < 700) return;
      promptRemoveDisplayedPhoto();
    });
  }
}

function wireFileListSwipeDelete() {
  const listEl = document.getElementById("private-file-list");
  if (!listEl || listEl.dataset.swipeDeleteWired) return;
  listEl.dataset.swipeDeleteWired = "1";
  let startX = null;
  let startY = null;
  let item = null;
  let suppressClick = false;

  listEl.addEventListener("touchstart", (e) => {
    if (downloadMode || e.touches.length !== 1) {
      startX = null;
      return;
    }
    if (e.target.closest("button, input, .folder-item")) {
      startX = null;
      return;
    }
    item = e.target.closest(".file-item");
    if (!item) {
      startX = null;
      return;
    }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  listEl.addEventListener("touchend", (e) => {
    if (startX == null || !item || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    const row = item;
    startX = null;
    item = null;
    if (dx > -50 || Math.abs(dx) < Math.abs(dy)) return;
    suppressClick = true;
    const key = row.dataset.key;
    const name = decodeURIComponent(row.dataset.name || "");
    if (key) window.handleDeleteFile(key, name);
  }, { passive: true });

  listEl.addEventListener("click", (e) => {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick = false;
  }, true);
}

function confirmRemoveFile(encodedKey, name) {
  const key = decodeURIComponent(encodedKey || "");
  const extra = currentUserId && (
    key.startsWith(`users/${currentUserId}/Videos/`)
    || key.startsWith(`users/${currentUserId}/Music/`)
  )
    ? " This also removes it from Format Conversions and deletes the original upload."
    : "";
  return confirm(`Remove "${name}"?${extra}`);
}

async function deleteFileByKey(encodedKey, name, { skipConfirm = false } = {}) {
  if (!skipConfirm && !confirmRemoveFile(encodedKey, name)) return false;
  const key = decodeURIComponent(encodedKey || "");
  try {
    const apiUrl = await getDropboxApiUrl();
    const res = await authFetch(`${apiUrl}files/${encodedKey}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (currentUserId && key.startsWith(`users/${currentUserId}/`)) {
      await forgetConvertedVideo({ key });
    }
    return true;
  } catch (err) {
    if (isAuthError(err)) {
      handleSessionExpired();
      return false;
    }
    alert("Could not delete: " + err.message);
    return false;
  }
}

let photoDeleteInFlight = false;

async function promptRemoveDisplayedPhoto() {
  if (photoDeleteInFlight) return;
  const fromCaptions = isPrivateCaptionsOpen();
  const fromSlideshow = isPrivateSlideshowOpen();
  if (!fromCaptions && !fromSlideshow) return;
  const key = fromCaptions ? captionKeys[captionIndex] : slideKeys[slideIndex];
  if (!key) return;
  photoDeleteInFlight = true;
  try {
    const name = fileNameFromKey(key);
    if (!confirmRemoveFile(encodeURIComponent(key), name)) return;
    await withListOpProgress("Removing", async () => {
      const deleted = await deleteFileByKey(encodeURIComponent(key), name, { skipConfirm: true });
      if (!deleted) return;
      if (fromCaptions) {
        captionKeys = captionKeys.filter((k) => k !== key);
        if (!captionKeys.length) await closePrivateCaptions();
        else await showCaptionPhoto(Math.min(captionIndex, captionKeys.length - 1));
      } else {
        slideKeys = slideKeys.filter((k) => k !== key);
        if (!slideKeys.length) closePrivateSlideshow();
        else showPrivateSlide(Math.min(slideIndex, slideKeys.length - 1));
      }
      await reloadFilesAfterOp();
    });
  } finally {
    photoDeleteInFlight = false;
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const addOpen = document.getElementById("videos-add-list") && !document.getElementById("videos-add-list").hidden;
    const fileOpen = [...document.querySelectorAll(".file-menu-list")].some((el) => !el.hidden);
    if (addOpen || fileOpen) {
      e.preventDefault();
      closeVideosMenus();
      return;
    }
  }
  if (isPrivateCaptionsOpen()) {
    if (e.key === "Escape") { e.preventDefault(); closePrivateCaptions(); }
    else if (e.target && e.target.id === "private-caption-text") return;
    else if (e.key === "ArrowLeft") { e.preventDefault(); privateCaptionPrev(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); privateCaptionNext(); }
    return;
  }
  if (!document.getElementById("video-edit-modal")?.hidden) {
    if (e.key === "Escape") { e.preventDefault(); closeVideoEdit(); }
    return;
  }
  if (document.getElementById("inline-video-player")?.classList.contains("is-open")) {
    if (e.key === "Escape") { e.preventDefault(); closeInlineVideo(); }
    else if (!["INPUT", "TEXTAREA"].includes(e.target?.tagName || "")) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        skipInlineVideo(e.shiftKey ? -VIDEO_NUDGE_SECONDS : -VIDEO_SKIP_SECONDS);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        skipInlineVideo(e.shiftKey ? VIDEO_NUDGE_SECONDS : VIDEO_SKIP_SECONDS);
      }
      else if (canClipInlineVideo(inlineVideoKey)) {
        if (e.key === "i" || e.key === "I") { e.preventDefault(); markInlineVideoClip("start"); }
        else if (e.key === "o" || e.key === "O") { e.preventDefault(); markInlineVideoClip("end"); }
      }
    }
    return;
  }
  if (!isPrivateSlideshowOpen()) return;
  if (e.key === "Escape") { e.preventDefault(); closePrivateSlideshow(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); privateSlidePrev(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); privateSlideNext(); }
  else if (e.key === " ") { e.preventDefault(); togglePrivateSlidePlay(); }
});

// ── Download mode ─────────────────────────────────────────────────────────────
window.toggleDownloadMode = function () {
  downloadMode = !downloadMode;
  if (downloadMode) videoCombineMode = false;
  syncVideoEditControls();
  document.getElementById("download-mode-btn").textContent         = downloadMode ? "✕ Cancel" : "⬇ Download";
  document.getElementById("check-all-btn").style.display           = downloadMode ? "inline-block" : "none";
  document.getElementById("download-selected-btn").style.display   = downloadMode ? "inline-block" : "none";
  loadFiles(currentPrefix);
};

window.checkAll = function () {
  const checkboxes = document.querySelectorAll(".file-checkbox");
  const allChecked = [...checkboxes].every((cb) => cb.checked);
  checkboxes.forEach((cb) => (cb.checked = !allChecked));
  document.getElementById("check-all-btn").textContent = allChecked ? "☑ Check All" : "☐ Uncheck All";
};

window.downloadSelected = async function () {
  const checkboxes = [...document.querySelectorAll(".file-checkbox:checked")];
  if (!checkboxes.length) { alert("No files selected."); return; }
  const btn = document.getElementById("download-selected-btn");
  btn.disabled = true;
  for (const cb of checkboxes) {
    const key  = cb.dataset.key;
    const name = key.split("/").pop();
    btn.textContent = `Downloading ${name}…`;
    try {
      const url = await getPresignedUrl(key);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob    = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl; a.download = name; a.style.display = "none";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      await new Promise((r) => setTimeout(r, 1000));
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      if (isAuthError(err)) { handleSessionExpired(); return; }
      console.error(`Failed to download ${name}:`, err);
    }
  }
  btn.textContent = "⬇ Download Selected";
  btn.disabled = false;
};

// ── Delete / folder ops ───────────────────────────────────────────────────────
window.handleDeleteFile = async function (encodedKey, name) {
  if (!confirmRemoveFile(encodedKey, name)) return;
  await withListOpProgress("Removing", async () => {
    if (await deleteFileByKey(encodedKey, name, { skipConfirm: true })) {
      await reloadFilesAfterOp();
    }
  });
};

window.handleEmptyFolder = async function (encodedKey, name) {
  if (!confirm(`Empty "${name}"?`)) return;
  await withListOpProgress("Emptying folder", async () => {
    try {
      const apiUrl = await getDropboxApiUrl();
      const res = await authFetch(`${apiUrl}files?prefix=${encodedKey}&mode=empty`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await forgetConvertedVideo({ prefix: decodeURIComponent(encodedKey) });
      await reloadFilesAfterOp();
    } catch (err) {
      if (isAuthError(err)) { handleSessionExpired(); return; }
      alert("Could not empty folder: " + err.message);
    }
  });
};

window.handleRemoveFolder = async function (encodedKey, name) {
  if (!confirm(`Remove folder "${name}" and all its contents?`)) return;
  await withListOpProgress("Removing", async () => {
    try {
      const apiUrl = await getDropboxApiUrl();
      const res = await authFetch(`${apiUrl}files?prefix=${encodedKey}&mode=remove`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await forgetConvertedVideo({ prefix: decodeURIComponent(encodedKey) });
      const parent = decodeURIComponent(encodedKey).split("/").slice(0, -2).join("/");
      await loadFiles(parent ? parent + "/" : "", { keepVisibleList: true });
    } catch (err) {
      if (isAuthError(err)) { handleSessionExpired(); return; }
      alert("Could not remove folder: " + err.message);
    }
  });
};

function fileLengthSelector(key) {
  const enc = encodeURIComponent(key);
  return typeof CSS !== "undefined" && CSS.escape
    ? `.file-length[data-key="${CSS.escape(enc)}"]`
    : `.file-length[data-key="${enc.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

function setFileLengthDisplay(key, seconds) {
  const el = document.querySelector(fileLengthSelector(key));
  if (el) el.textContent = formatMediaLength(seconds);
}

function probeMediaDuration(url, kind) {
  return new Promise((resolve) => {
    const el = document.createElement(kind === "audio" ? "audio" : "video");
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      el.removeAttribute("src");
      try { el.load(); } catch { /* ignore */ }
      resolve(value);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const n = Number(el.duration);
      finish(Number.isFinite(n) && n > 0 && n !== Infinity ? n : null);
    };
    el.onerror = () => finish(null);
    setTimeout(() => finish(null), 12000);
    el.src = url;
  });
}

async function fillFileMediaLengths(files, gen) {
  const playable = (files || []).filter((f) => isPlayableVideoKey(f.key) || isPlayableAudioKey(f.key));
  for (const f of playable) {
    if (gen !== filesLoadGen) return;
    const cached = mediaLengthCache.get(f.key);
    if (cached != null) {
      setFileLengthDisplay(f.key, cached);
      continue;
    }
    try {
      const url = await getPresignedUrl(f.key);
      if (gen !== filesLoadGen) return;
      const seconds = await probeMediaDuration(url, isPlayableAudioKey(f.key) ? "audio" : "video");
      if (seconds == null) continue;
      mediaLengthCache.set(f.key, seconds);
      if (gen !== filesLoadGen) return;
      setFileLengthDisplay(f.key, seconds);
    } catch (err) {
      if (isAuthError(err)) { handleSessionExpired(); return; }
    }
  }
}
