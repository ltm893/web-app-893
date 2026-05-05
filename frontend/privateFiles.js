// privateFiles.js — invite-only private file browser
import { signIn, signOut, getIdToken, isSignedIn, authHeaders, getDropboxApiUrl } from "./auth.js";

let currentPrefix = "";
let currentUserId = null;
let currentTab = "shared";

// ── Audio player state ────────────────────────────────────────────────────────
let playlist   = [];
let trackIndex = 0;
let audio      = null;

// ── Download mode ─────────────────────────────────────────────────────────────
let downloadMode = false;

window.initPrivate = async function () {
  if (isSignedIn()) {
    await showFileBrowser();
  } else {
    showLoginForm();
  }
};

function showLoginForm() {
  document.getElementById("private-login").style.display   = "block";
  document.getElementById("private-browser").style.display = "none";
}

async function showFileBrowser() {
  document.getElementById("private-login").style.display   = "none";
  document.getElementById("private-browser").style.display = "block";

  // Decode sub from ID token JWT
  try {
    const token   = await getIdToken();
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    currentUserId = payload.sub;
  } catch {
    currentUserId = "unknown";
  }

  await ensurePrivateFolder();
  currentTab = "shared";
  updateTabUI();
  loadFiles("");
}

async function ensurePrivateFolder() {
  const prefix = `users/${currentUserId}/`;
  try {
    const apiUrl = await getDropboxApiUrl();
    const headers = await authHeaders();
    const res = await fetch(`${apiUrl}files?prefix=${encodeURIComponent(prefix)}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { folders, files } = await res.json();
    if (folders.length === 0 && files.length === 0) {
      const putRes = await fetch(`${apiUrl}files`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ key: prefix, contentType: "application/x-directory" }),
      });
      if (!putRes.ok) throw new Error(`HTTP ${putRes.status}`);
      const { url } = await putRes.json();
      await fetch(url, { method: "PUT", headers: { "Content-Type": "application/x-directory" }, body: "" });
    }
  } catch (err) {
    console.warn("Could not ensure private folder:", err.message);
  }
}

function updateTabUI() {
  document.getElementById("tab-btn-shared").classList.toggle("active", currentTab === "shared");
  document.getElementById("tab-btn-mine").classList.toggle("active",   currentTab === "mine");
}

window.switchTab = function (tab) {
  if (!currentUserId) return;
  currentTab = tab;
  updateTabUI();
  loadFiles(tab === "shared" ? "" : `users/${currentUserId}/`);
};

// ── Upload ────────────────────────────────────────────────────────────────────
window.toggleUpload = function () {
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

  const key = currentPrefix ? `${currentPrefix}${file.name}` : file.name;
  statusEl.textContent = "Uploading…";
  statusEl.style.color = "#555";

  try {
    const apiUrl  = await getDropboxApiUrl();
    const headers = await authHeaders();
    const res = await fetch(`${apiUrl}files`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
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
  try {
    const apiUrl  = await getDropboxApiUrl();
    const headers = await authHeaders();
    const res = await fetch(`${apiUrl}files`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ key, contentType: "application/x-directory" }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { url } = await res.json();
    const uploadRes = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/x-directory" }, body: "" });
    if (!uploadRes.ok) throw new Error(`HTTP ${uploadRes.status}`);
    loadFiles(currentPrefix);
  } catch (err) {
    alert("Could not create folder: " + err.message);
  }
};

// ── Sign In / Out ─────────────────────────────────────────────────────────────
window.handleSignIn = async function () {
  const email    = document.getElementById("private-email").value.trim();
  const password = document.getElementById("private-password").value;
  const errEl    = document.getElementById("private-error");
  errEl.textContent = "";
  try {
    await signIn(email, password);
    await showFileBrowser();
  } catch (err) {
    errEl.textContent = err.message ?? "Sign in failed.";
  }
};

window.handleSignOut = async function () {
  stopPlayer();
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
    let html  = `<a href="#" onclick="switchTab('mine'); return false;">MyStuff</a>`;
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

window.navigateTo = function (encodedPrefix) {
  loadFiles(decodeURIComponent(encodedPrefix));
};

// ── File listing ──────────────────────────────────────────────────────────────
async function loadFiles(prefix) {
  currentPrefix = prefix;
  renderBreadcrumb(prefix);
  const listEl = document.getElementById("private-file-list");
  listEl.innerHTML = "<li>Loading…</li>";

  try {
    const apiUrl  = await getDropboxApiUrl();
    const headers = await authHeaders();
    const url     = prefix
      ? `${apiUrl}files?prefix=${encodeURIComponent(prefix)}`
      : `${apiUrl}files`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let { folders, files } = await res.json();

    if (currentTab === "shared") folders = folders.filter((f) => f.key !== "users/");

    const hasFiles = files.length > 0;
    document.getElementById("download-mode-btn").style.display = hasFiles ? "inline-block" : "none";
    if (!hasFiles && downloadMode) {
      downloadMode = false;
      document.getElementById("check-all-btn").style.display      = "none";
      document.getElementById("download-selected-btn").style.display = "none";
    }

    if (!folders.length && !files.length) { listEl.innerHTML = "<li>No files found.</li>"; return; }

    const mp3Files = files.filter((f) => f.key.toLowerCase().endsWith(".mp3"));
    const hasMp3   = mp3Files.length > 0;
    const mp3Html  = hasMp3 ? `
      <li class="mp3-controls" style="list-style:none; padding:0.4rem 0; border-bottom:1px solid #eee; display:flex; gap:0.5rem;">
        <button onclick="startPlaylist(false)" style="font-size:0.85rem;">▶ Play All</button>
        <button onclick="startPlaylist(true)"  style="font-size:0.85rem;">🔀 Shuffle</button>
        <span style="font-size:0.8rem; color:#888; align-self:center;">${mp3Files.length} track${mp3Files.length !== 1 ? "s" : ""}</span>
      </li>` : "";

    const folderHtml = folders.map((f) => {
      const name = f.key.replace(prefix, "").replace("/", "");
      return `<li class="folder-item">
        <a href="#" onclick="navigateTo('${encodeURIComponent(f.key)}'); return false;">📁 ${name}</a>
        ${f.hasSubFolders ? ""
          : f.hasFiles
            ? `<button class="folder-action-btn danger" onclick="handleEmptyFolder('${encodeURIComponent(f.key)}','${name}')">∅ Empty</button>`
            : `<button class="folder-action-btn danger" onclick="handleRemoveFolder('${encodeURIComponent(f.key)}','${name}')">- Remove</button>`
        }
      </li>`;
    });

    const fileHtml = files.map((f) => {
      const name    = f.key.split("/").pop();
      const size    = formatBytes(f.size);
      const isMp3   = f.key.toLowerCase().endsWith(".mp3");
      const playBtn = isMp3 && !downloadMode ? `<button class="play-btn" onclick="playSingleTrack('${encodeURIComponent(f.key)}')">▶</button>` : "";
      const checkbox = downloadMode ? `<input type="checkbox" class="file-checkbox" data-key="${f.key}" style="margin-right:0.4rem; cursor:pointer;" />` : "";
      const deleteBtn = !downloadMode ? `<button class="file-delete-btn" onclick="handleDeleteFile('${encodeURIComponent(f.key)}','${name}')">- Remove</button>` : "";
      return `<li class="file-item">
        ${checkbox}${playBtn}
        <a href="#" onclick="openFile('${encodeURIComponent(f.key)}'); return false;">${isMp3 ? "🎵" : "📄"} ${name}</a>
        <span class="file-size">${size}</span>
        ${deleteBtn}
      </li>`;
    });

    listEl.innerHTML = mp3Html + [...folderHtml, ...fileHtml].join("");
    window._currentMp3Keys = mp3Files.map((f) => f.key);

  } catch (err) {
    listEl.innerHTML = `<li style="color:red">Error: ${err.message}</li>`;
  }
}

window.openFile = async function (encodedKey) {
  try {
    const apiUrl  = await getDropboxApiUrl();
    const headers = await authHeaders();
    const res = await fetch(`${apiUrl}files/${encodedKey}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { url } = await res.json();
    window.open(url, "_blank");
  } catch (err) {
    alert("Could not open file: " + err.message);
  }
};

// ── Audio player ──────────────────────────────────────────────────────────────
async function getPresignedUrl(key) {
  const apiUrl  = await getDropboxApiUrl();
  const headers = await authHeaders();
  const res = await fetch(`${apiUrl}files/${encodeURIComponent(key)}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { url } = await res.json();
  return url;
}

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
  const key  = playlist[index];
  const name = key.split("/").pop();
  showPlayer(name, index, playlist.length);
  updatePlayerLoading(true);
  try {
    const url = await getPresignedUrl(key);
    if (!audio) {
      audio = new Audio();
      audio.addEventListener("ended",      () => playTrack(trackIndex + 1));
      audio.addEventListener("timeupdate", updateProgress);
      audio.addEventListener("canplay",    () => updatePlayerLoading(false));
    } else {
      audio.pause(); audio.src = "";
    }
    audio.src = url; trackIndex = index; audio.play();
  } catch (err) {
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

// ── Download mode ─────────────────────────────────────────────────────────────
window.toggleDownloadMode = function () {
  downloadMode = !downloadMode;
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
      console.error(`Failed to download ${name}:`, err);
    }
  }
  btn.textContent = "⬇ Download Selected";
  btn.disabled = false;
};

// ── Delete / folder ops ───────────────────────────────────────────────────────
window.handleDeleteFile = async function (encodedKey, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    const apiUrl  = await getDropboxApiUrl();
    const headers = await authHeaders();
    const res = await fetch(`${apiUrl}files/${encodedKey}`, { method: "DELETE", headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadFiles(currentPrefix);
  } catch (err) { alert("Could not delete: " + err.message); }
};

window.handleEmptyFolder = async function (encodedKey, name) {
  if (!confirm(`Empty "${name}"?`)) return;
  try {
    const apiUrl  = await getDropboxApiUrl();
    const headers = await authHeaders();
    const res = await fetch(`${apiUrl}files?prefix=${encodedKey}&mode=empty`, { method: "DELETE", headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadFiles(currentPrefix);
  } catch (err) { alert("Could not empty folder: " + err.message); }
};

window.handleRemoveFolder = async function (encodedKey, name) {
  if (!confirm(`Remove folder "${name}" and all its contents?`)) return;
  try {
    const apiUrl  = await getDropboxApiUrl();
    const headers = await authHeaders();
    const res = await fetch(`${apiUrl}files?prefix=${encodedKey}&mode=remove`, { method: "DELETE", headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parent = decodeURIComponent(encodedKey).split("/").slice(0, -2).join("/");
    loadFiles(parent ? parent + "/" : "");
  } catch (err) { alert("Could not remove folder: " + err.message); }
};

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
