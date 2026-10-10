// pdfSearch.js — private OCR PDF search (pdf-search-893)
import {
  signIn, signOut, ensureSignedIn, authFetch, isAuthError, getPdfSearchApiUrl, loadingHtml,
  syncAncestryNav,
} from "./auth.js";
import { putObject, putMultipart } from "./s3Upload.js";
import { extractPageList, extractPrintUrl, extractClipboardState, extractOverlayAction, extractKeysToRemove } from "./extractPages.js";
import {
  folderOf, groupedBoxes, compareCatalogTitle,
  NEW_BOX_SELECT, resolvePdfUploadFolder,
  filterHitsByFolders,
} from "./pdfSearchSort.js";

let pdfSearchReady = false;
let catalogDocs = [];
let activeFolder = "";

export async function initPdfSearch() {
  if (!(await syncAncestryNav())) return;
  const login = document.getElementById("pdfsearch-login");
  const loading = document.getElementById("pdfsearch-loading");
  const app = document.getElementById("pdfsearch-app");
  if (!login || !app) return;

  loading.style.display = "block";
  login.style.display = "none";
  app.style.display = "none";

  const signedIn = await ensureSignedIn();
  loading.style.display = "none";
  if (!signedIn) {
    login.style.display = "block";
    return;
  }

  const apiUrl = await getPdfSearchApiUrl();
  if (!apiUrl) {
    document.getElementById("pdfsearch-error").textContent =
      "PDF search is not configured yet (missing PDF_SEARCH_API_URL).";
    login.style.display = "block";
    return;
  }

  app.style.display = "block";
  if (!pdfSearchReady) {
    pdfSearchReady = true;
    document.getElementById("pdfsearch-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      hideSuggest();
      runSearch();
    });
    wireSearchSuggest();
    wireCatalogDescExpand();
    document.getElementById("pdfsearch-home")?.addEventListener("click", (e) => {
      e.preventDefault();
      goHome();
    });
    wireBrowseSelects();
    wireBrowseMode();
    wireArchivesPanel();
    wireSearchScope();
    document.getElementById("pdfsearch-viewer-close")?.addEventListener("click", () => {
      closePdfSearchViewer(true);
    });
    document.getElementById("pdfsearch-viewer-prev")?.addEventListener("click", () => {
      showPagedPage(pagedPage - 1);
    });
    document.getElementById("pdfsearch-viewer-next")?.addEventListener("click", () => {
      showPagedPage(pagedPage + 1);
    });
    const pageInput = document.getElementById("pdfsearch-viewer-page");
    if (pageInput && !pageInput.dataset.wired) {
      pageInput.dataset.wired = "1";
      pageInput.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        goToViewerPage(pageInput.value);
      });
      pageInput.addEventListener("change", () => goToViewerPage(pageInput.value));
    }
    const uploadInput = document.getElementById("pdfsearch-upload-input");
    if (uploadInput && !uploadInput.dataset.wired) {
      uploadInput.dataset.wired = "1";
      uploadInput.addEventListener("change", async () => {
        const files = [...(uploadInput.files || [])];
        uploadInput.value = "";
        await uploadPdfsToArchive(files);
      });
    }
    const uploadBtn = document.getElementById("pdfsearch-upload-btn");
    if (uploadBtn && !uploadBtn.dataset.wired) {
      uploadBtn.dataset.wired = "1";
      uploadBtn.addEventListener("click", () => {
        document.getElementById("pdfsearch-upload-input")?.click();
      });
    }
    const addBoxSel = document.getElementById("pdfsearch-add-box-select");
    if (addBoxSel && !addBoxSel.dataset.wired) {
      addBoxSel.dataset.wired = "1";
      addBoxSel.addEventListener("change", () => {
        if (addBoxSel.value === NEW_BOX_SELECT) {
          setAddBoxName(nextBoxName(catalogDocs), { auto: true });
        }
        syncAddBoxNameWrap();
      });
    }
    document.addEventListener("keydown", (e) => {
      if (!document.getElementById("pdfsearch-viewer")?.classList.contains("is-open")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        const extractOverlay = document.getElementById("pdfsearch-viewer-extract-overlay");
        if (extractOverlay && !extractOverlay.hidden) {
          setExtractPanel(false);
          return;
        }
        closePdfSearchViewer(true);
        return;
      }
      if (!document.getElementById("pdfsearch-viewer")?.classList.contains("is-paged")) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        showPagedPage(pagedPage - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        showPagedPage(pagedPage + 1);
      }
    });
    await loadCatalog();
  }
  await syncPdfSearchViewer();
}

window.handlePdfSearchSignIn = async function handlePdfSearchSignIn() {
  const email = document.getElementById("pdfsearch-email").value.trim();
  const password = document.getElementById("pdfsearch-password").value;
  const err = document.getElementById("pdfsearch-error");
  err.textContent = "";
  try {
    await signIn(email, password);
    await initPdfSearch();
  } catch (e) {
    err.textContent = e.message || "Sign in failed";
  }
};

window.handlePdfSearchSignOut = async function handlePdfSearchSignOut() {
  stopOcrPoll();
  closePdfSearchViewer(true);
  await signOut();
  pdfSearchReady = false;
  await initPdfSearch();
};

async function loadCatalog() {
  const status = document.getElementById("pdfsearch-browse-status");
  try {
    const apiUrl = await getPdfSearchApiUrl();
    const res = await authFetch(`${apiUrl}search`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    catalogDocs = (data.documents || [])
      .filter((d) => d.key && d.filename)
      .sort(compareCatalogTitle);
    populateSearchBoxList();
    showBoxes();
    clearSearch();
    if (!document.getElementById("pdfsearch-panel-add")?.hidden) {
      const addSel = document.getElementById("pdfsearch-add-box-select");
      if (addSel && addSel.value === NEW_BOX_SELECT) {
        setAddBoxName(nextBoxName(catalogDocs), { auto: true });
      }
    }
  } catch (e) {
    if (isAuthError(e)) {
      await initPdfSearch();
      return;
    }
    status.textContent = e.message || "Could not load documents";
  }
}

function boxesAndPdfsStatus(readyCount) {
  const boxes = groupedBoxes(catalogDocs);
  const n = catalogDocs.length;
  if (!n) return "";
  const ready = readyCount == null
    ? catalogDocs.filter((d) => d.status === "READY").length
    : readyCount;
  return `${boxes.length} box${boxes.length === 1 ? "" : "es"} · ${ready} of ${n} PDF${n === 1 ? "" : "s"}`;
}

function showBoxes() {
  const status = document.getElementById("pdfsearch-browse-status");
  activeFolder = "";
  const ready = catalogDocs.filter((d) => d.status === "READY").length;
  const boxQ = document.getElementById("pdfsearch-box-q");
  if (boxQ) boxQ.value = "";
  hideBoxSuggest();
  populateFileSelect("");
  hideBrowseDetail();
  parkFilePicker();
  placeFilePicker();
  setNav({ boxes: false });
  if (!catalogDocs.length) {
    status.textContent = "No PDFs indexed yet — OCR may still be running.";
    return;
  }
  status.textContent = boxesAndPdfsStatus(ready);
}

function showFolder(folder, fileKey) {
  const boxes = groupedBoxes(catalogDocs);
  const box = boxes.find((b) => b.folder === folder);
  if (!box) {
    showBoxes();
    return;
  }
  const boxQ = document.getElementById("pdfsearch-box-q");
  if (boxQ) boxQ.value = folder;
  hideBoxSuggest();
  const fileSel = document.getElementById("pdfsearch-file-select");
  const keepKey = fileKey || (folder === activeFolder ? fileSel?.value : "");
  activeFolder = folder;
  populateFileSelect(folder);
  if (keepKey && fileSel && [...fileSel.options].some((o) => o.value === keepKey)) {
    fileSel.value = keepKey;
    showBrowseDetail(keepKey);
  } else {
    hideBrowseDetail();
  }
  setNav({ boxes: true });
  const status = document.getElementById("pdfsearch-browse-status");
  const ready = box.docs.filter((d) => d.status === "READY").length;
  if (status) status.textContent = `${folder} · ${ready} of ${box.docs.length} PDF${box.docs.length === 1 ? "" : "s"}`;
  const allWrap = document.getElementById("pdfsearch-box-all");
  if (allWrap && !allWrap.hidden) renderAllBoxes();
  else {
    placeFilePicker();
    placeBrowseDetail();
  }
}

let addBoxAutoName = "";

function nextBoxName(docs) {
  let max = 0;
  for (const d of docs || []) {
    const m = /^BOX(\d+)$/i.exec(folderOf(d));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `BOX${String(max + 1).padStart(3, "0")}`;
}

function existingBoxNames() {
  return groupedBoxes(catalogDocs).map((b) => b.folder);
}

function syncAddBoxNameWrap() {
  const sel = document.getElementById("pdfsearch-add-box-select");
  const wrap = document.getElementById("pdfsearch-add-box-name-wrap");
  if (wrap) wrap.hidden = Boolean(sel && sel.value && sel.value !== NEW_BOX_SELECT);
}

function populateAddBoxSelect(prefer) {
  const sel = document.getElementById("pdfsearch-add-box-select");
  if (!sel) return;
  const boxes = groupedBoxes(catalogDocs);
  const keep = prefer || sel.value;
  sel.innerHTML = `<option value="${NEW_BOX_SELECT}">New box</option>` + boxes.map((b) => {
    const n = b.docs.length;
    return `<option value="${escapeAttr(b.folder)}">${escapeHtml(b.folder)} · ${n} PDF${n === 1 ? "" : "s"}</option>`;
  }).join("");
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  else sel.value = NEW_BOX_SELECT;
  syncAddBoxNameWrap();
}

function setAddBoxName(name, { auto = false } = {}) {
  const input = document.getElementById("pdfsearch-add-box-name");
  const next = String(name || "").trim();
  const isExisting = Boolean(next) && existingBoxNames().includes(next);
  populateAddBoxSelect(isExisting ? next : NEW_BOX_SELECT);
  if (isExisting || !input) {
    syncAddBoxNameWrap();
    return;
  }
  if (auto && input.value && input.value !== addBoxAutoName) {
    syncAddBoxNameWrap();
    return;
  }
  input.value = next;
  addBoxAutoName = auto ? next : "";
  syncAddBoxNameWrap();
}

function populateFileSelect(folder) {
  const wrap = document.getElementById("pdfsearch-file-wrap");
  const sel = document.getElementById("pdfsearch-file-select");
  const box = groupedBoxes(catalogDocs).find((b) => b.folder === folder);
  if (!wrap || !sel) return;
  if (!folder || !box) {
    wrap.hidden = true;
    sel.innerHTML = `<option value="">Select a PDF</option>`;
    return;
  }
  wrap.hidden = false;
  sel.innerHTML = `<option value="">Select a PDF</option>` + box.docs.map((d) => {
    const pages = d.pageCount ? ` · ${d.pageCount} pages` : "";
    const badge = d.status === "READY" ? "" : ` (${d.status || "pending"})`;
    return `<option value="${escapeAttr(d.key)}">${escapeHtml(d.filename)}${pages}${badge}</option>`;
  }).join("");
}

function hideBrowseDetail() {
  const detail = document.getElementById("pdfsearch-browse-detail");
  if (!detail) return;
  detail.hidden = true;
  detail.innerHTML = "";
  parkBrowseDetail();
}

function showBrowseDetail(key) {
  const detail = document.getElementById("pdfsearch-browse-detail");
  const doc = catalogDocs.find((d) => d.key === key);
  if (!detail || !doc) {
    hideBrowseDetail();
    return;
  }
  const desc = (doc.description || "").trim() || "No description yet.";
  detail.hidden = false;
  detail.innerHTML = `
    <p class="pdfsearch-browse-desc">${escapeHtml(desc)}</p>
    <div class="pdfsearch-doc-actions">
      <button type="button" class="pdfsearch-open" data-key="${escapeAttr(doc.key)}">Open PDF</button>
      <button type="button" class="pdfsearch-remove" data-key="${escapeAttr(doc.key)}">Remove</button>
    </div>
    <p id="pdfsearch-browse-extract-status" class="pdfsearch-status"></p>
  `;
  placeBrowseDetail();
}

async function removePdf(key, btn) {
  const doc = catalogDocs.find((d) => d.key === key);
  const name = doc?.filename || key.split("/").pop() || key;
  if (!window.confirm(`Remove ${name}? It will be deleted from this box and from search.`)) return;
  const status = document.getElementById("pdfsearch-browse-extract-status")
    || document.getElementById("pdfsearch-browse-status");
  if (btn) btn.disabled = true;
  if (status) status.textContent = "Removing…";
  const folder = folderOf(doc || { folder: activeFolder });
  try {
    const apiUrl = await getPdfSearchApiUrl();
    const res = await authFetch(`${apiUrl}uploads?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (viewerDocKey === key) closePdfSearchViewer(true);
    catalogDocs = catalogDocs.filter((d) => d.key !== key);
    hideBrowseDetail();
    if (groupedBoxes(catalogDocs).some((b) => b.folder === folder)) showFolder(folder);
    else showBoxes();
    if (status) status.textContent = "Removed.";
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const check = await authFetch(`${apiUrl}search`);
      const listed = await check.json().catch(() => ({}));
      if (!check.ok) break;
      if (!(listed.documents || []).some((d) => d.key === key)) break;
    }
    await loadCatalog();
    if (folder && groupedBoxes(catalogDocs).some((b) => b.folder === folder)) showFolder(folder);
  } catch (err) {
    if (isAuthError(err)) {
      await initPdfSearch();
      return;
    }
    if (status) status.textContent = err.message || "Could not remove";
    if (btn) btn.disabled = false;
  }
}

function wireBrowseSelects() {
  const fileSel = document.getElementById("pdfsearch-file-select");
  if (fileSel && !fileSel.dataset.wired) {
    fileSel.dataset.wired = "1";
    fileSel.addEventListener("change", () => {
      const key = fileSel.value;
      if (key) showBrowseDetail(key);
      else hideBrowseDetail();
    });
    fileSel.addEventListener("click", (e) => e.stopPropagation());
    fileSel.addEventListener("mousedown", (e) => e.stopPropagation());
  }
}

function setBrowseMode(mode) {
  const searchBtn = document.getElementById("pdfsearch-mode-search");
  const allBtn = document.getElementById("pdfsearch-mode-all");
  const extractsBtn = document.getElementById("pdfsearch-mode-extracts");
  const searchWrap = document.getElementById("pdfsearch-box-search-wrap");
  const allWrap = document.getElementById("pdfsearch-box-all");
  const extractList = document.getElementById("pdfsearch-extract-all");
  const next = mode === "all" || mode === "extracts" ? mode : "search";
  searchBtn?.classList.toggle("is-active", next === "search");
  allBtn?.classList.toggle("is-active", next === "all");
  extractsBtn?.classList.toggle("is-active", next === "extracts");
  if (searchWrap) searchWrap.hidden = next !== "search";
  if (allWrap) allWrap.hidden = next !== "all";
  if (extractList) extractList.hidden = next !== "extracts";
  const extractActions = document.getElementById("pdfsearch-extract-actions");
  if (extractActions) extractActions.hidden = next !== "extracts";
  hideBoxSuggest();
  parkFilePicker();
  parkBrowseDetail();
  const fileWrap = document.getElementById("pdfsearch-file-wrap");
  if (next === "extracts") {
    if (fileWrap) fileWrap.hidden = true;
    const detail = document.getElementById("pdfsearch-browse-detail");
    if (detail) detail.hidden = true;
  } else if (activeFolder && fileWrap) {
    fileWrap.hidden = false;
    const key = document.getElementById("pdfsearch-file-select")?.value;
    if (key) showBrowseDetail(key);
  }
  const status = document.getElementById("pdfsearch-browse-status");
  if (next !== "extracts" && status?.dataset.mode === "extracts") {
    delete status.dataset.mode;
    status.textContent = boxesAndPdfsStatus();
  }
  if (next === "all") renderAllBoxes();
  if (next === "search") {
    const boxQ = document.getElementById("pdfsearch-box-q");
    renderBoxSuggest(boxQ?.value || "");
  }
  placeFilePicker();
  placeBrowseDetail();
}

function parkFilePicker() {
  const wrap = document.getElementById("pdfsearch-file-wrap");
  const slot = document.getElementById("pdfsearch-file-slot");
  if (wrap && slot && wrap.parentElement !== slot) slot.appendChild(wrap);
  wrap?.classList.remove("is-inline");
}

function parkBrowseDetail() {
  const detail = document.getElementById("pdfsearch-browse-detail");
  const slot = document.getElementById("pdfsearch-detail-slot");
  if (detail && slot && detail.parentElement !== slot) slot.appendChild(detail);
  detail?.classList.remove("is-inline");
}

function activeArchiveRow() {
  const allList = document.getElementById("pdfsearch-box-all");
  if (!allList || allList.hidden || !activeFolder) return null;
  return [...allList.querySelectorAll("li")].find(
    (li) => li.getAttribute("data-folder") === activeFolder
  ) || null;
}

function placeFilePicker() {
  const wrap = document.getElementById("pdfsearch-file-wrap");
  const slot = document.getElementById("pdfsearch-file-slot");
  if (!wrap || !slot) return;
  const row = !wrap.hidden ? activeArchiveRow() : null;
  if (row) {
    row.appendChild(wrap);
    wrap.classList.add("is-inline");
    return;
  }
  if (wrap.parentElement !== slot) slot.appendChild(wrap);
  wrap.classList.remove("is-inline");
}

function placeBrowseDetail() {
  const detail = document.getElementById("pdfsearch-browse-detail");
  const slot = document.getElementById("pdfsearch-detail-slot");
  if (!detail || !slot) return;
  const row = !detail.hidden ? activeArchiveRow() : null;
  if (row) {
    row.appendChild(detail);
    detail.classList.add("is-inline");
    return;
  }
  if (detail.parentElement !== slot) slot.appendChild(detail);
  detail.classList.remove("is-inline");
}

function renderAllBoxes() {
  const list = document.getElementById("pdfsearch-box-all");
  if (!list) return;
  parkFilePicker();
  parkBrowseDetail();
  const boxes = groupedBoxes(catalogDocs);
  list.innerHTML = boxes.map((b) => {
    const n = b.docs.length;
    const active = b.folder === activeFolder ? " is-active" : "";
    return `<li class="pdfsearch-doc" data-folder="${escapeAttr(b.folder)}">
      <button type="button" class="pdfsearch-folder pdfsearch-open${active}" data-folder="${escapeAttr(b.folder)}">${escapeHtml(b.folder)}</button>
      <span class="pdfsearch-meta"> · ${n} PDF${n === 1 ? "" : "s"}</span>
    </li>`;
  }).join("");
  placeFilePicker();
  placeBrowseDetail();
}

function hideBoxSuggest() {
  const el = document.getElementById("pdfsearch-box-suggest");
  if (!el) return;
  el.hidden = true;
  el.classList.remove("is-open");
  el.innerHTML = "";
}

function renderBoxSuggest(q) {
  const el = document.getElementById("pdfsearch-box-suggest");
  if (!el) return;
  const prefix = String(q || "").trim().toLowerCase();
  const matches = groupedBoxes(catalogDocs).filter((b) => {
    if (!prefix) return true;
    return b.folder.toLowerCase().includes(prefix);
  });
  if (!matches.length) {
    hideBoxSuggest();
    return;
  }
  el.innerHTML = matches.map((b) => {
    const n = b.docs.length;
    return `<li><button type="button" data-folder="${escapeAttr(b.folder)}">${escapeHtml(b.folder)}<span class="pdfsearch-suggest-count"> · ${n} PDF${n === 1 ? "" : "s"}</span></button></li>`;
  }).join("");
  el.hidden = false;
  el.classList.add("is-open");
}

function wireArchivesPanel() {
  const sel = document.getElementById("pdfsearch-panel-select");
  if (sel && !sel.dataset.wired) {
    sel.dataset.wired = "1";
    sel.addEventListener("change", () => setArchivesPanel(sel.value));
  }
  setArchivesPanel(sel?.value || "search");
}

function setArchivesPanel(name) {
  const mode = name === "browse" || name === "add" ? name : "search";
  const sel = document.getElementById("pdfsearch-panel-select");
  if (sel && sel.value !== mode) sel.value = mode;
  const search = document.getElementById("pdfsearch-panel-search");
  const browse = document.getElementById("pdfsearch-panel-browse");
  const add = document.getElementById("pdfsearch-panel-add");
  if (search) search.hidden = mode !== "search";
  if (browse) browse.hidden = mode !== "browse";
  if (add) add.hidden = mode !== "add";
  if (mode !== "search") hideSuggest();
  if (mode !== "browse") hideBoxSuggest();
  if (mode === "add") {
    setAddBoxName(nextBoxName(catalogDocs), { auto: true });
    populateAddBoxSelect(NEW_BOX_SELECT);
  }
}

function wireBrowseMode() {
  const searchBtn = document.getElementById("pdfsearch-mode-search");
  const allBtn = document.getElementById("pdfsearch-mode-all");
  const allList = document.getElementById("pdfsearch-box-all");
  const boxQ = document.getElementById("pdfsearch-box-q");
  const suggest = document.getElementById("pdfsearch-box-suggest");
  if (searchBtn && !searchBtn.dataset.wired) {
    searchBtn.dataset.wired = "1";
    searchBtn.addEventListener("click", () => setBrowseMode("search"));
  }
  if (allBtn && !allBtn.dataset.wired) {
    allBtn.dataset.wired = "1";
    allBtn.addEventListener("click", () => {
      showBoxes();
      setBrowseMode("all");
    });
  }
  const extractsBtn = document.getElementById("pdfsearch-mode-extracts");
  if (extractsBtn && !extractsBtn.dataset.wired) {
    extractsBtn.dataset.wired = "1";
    extractsBtn.addEventListener("click", () => {
      showAllExtracts();
    });
  }
  if (allList && !allList.dataset.wired) {
    allList.dataset.wired = "1";
    allList.addEventListener("click", (e) => {
      if (e.target.closest("#pdfsearch-file-wrap") || e.target.closest("#pdfsearch-browse-detail")) return;
      const btn = e.target.closest("button.pdfsearch-folder[data-folder]");
      if (!btn || !allList.contains(btn)) return;
      e.preventDefault();
      showFolder(btn.getAttribute("data-folder") || "");
    });
  }
  if (boxQ && !boxQ.dataset.wired) {
    boxQ.dataset.wired = "1";
    boxQ.addEventListener("input", () => renderBoxSuggest(boxQ.value));
    boxQ.addEventListener("focus", () => renderBoxSuggest(boxQ.value));
    boxQ.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideBoxSuggest();
    });
  }
  if (suggest && !suggest.dataset.wired) {
    suggest.dataset.wired = "1";
    suggest.addEventListener("mousedown", (e) => {
      const btn = e.target.closest("[data-folder]");
      if (!btn) return;
      e.preventDefault();
      showFolder(btn.getAttribute("data-folder") || "");
    });
  }
  if (!document.body.dataset.pdfsearchBoxOutside) {
    document.body.dataset.pdfsearchBoxOutside = "1";
    document.addEventListener("click", (e) => {
      if (e.target.closest("#pdfsearch-box-search-wrap")) return;
      if (e.target.closest("#pdfsearch-mode-search")) return;
      hideBoxSuggest();
    });
  }
  setBrowseMode("search");
}

let searchBoxMode = "all";

function selectedSearchFolders() {
  if (searchBoxMode !== "some") return [];
  return [...document.querySelectorAll("#pdfsearch-search-box-list input:checked")]
    .map((el) => el.value)
    .filter(Boolean);
}

function populateSearchBoxList() {
  const list = document.getElementById("pdfsearch-search-box-list");
  if (!list) return;
  const prev = new Set([...list.querySelectorAll("input:checked")].map((el) => el.value));
  const had = list.querySelectorAll("input").length > 0;
  list.innerHTML = groupedBoxes(catalogDocs).map((b) => {
    const on = had && prev.has(b.folder);
    return `<label><input type="checkbox" value="${escapeAttr(b.folder)}"${on ? " checked" : ""}>${escapeHtml(b.folder)}</label>`;
  }).join("");
}

function setSearchScope(mode) {
  searchBoxMode = mode === "some" ? "some" : "all";
  document.getElementById("pdfsearch-search-all")?.classList.toggle("is-active", searchBoxMode === "all");
  document.getElementById("pdfsearch-search-some")?.classList.toggle("is-active", searchBoxMode === "some");
  const list = document.getElementById("pdfsearch-search-box-list");
  if (list) list.hidden = searchBoxMode !== "some";
}

function wireSearchScope() {
  const allBtn = document.getElementById("pdfsearch-search-all");
  const someBtn = document.getElementById("pdfsearch-search-some");
  if (allBtn && !allBtn.dataset.wired) {
    allBtn.dataset.wired = "1";
    allBtn.addEventListener("click", () => setSearchScope("all"));
  }
  if (someBtn && !someBtn.dataset.wired) {
    someBtn.dataset.wired = "1";
    someBtn.addEventListener("click", () => setSearchScope("some"));
  }
  setSearchScope(searchBoxMode);
}

async function runSearch() {
  const q = document.getElementById("pdfsearch-q").value.trim();
  const results = document.getElementById("pdfsearch-results");
  const status = document.getElementById("pdfsearch-search-status");
  const folders = selectedSearchFolders();
  if (!q) {
    clearSearch();
    return;
  }
  if (searchBoxMode === "some" && !folders.length) {
    results.innerHTML = "";
    status.textContent = "Pick at least one box.";
    setNav({ home: true });
    return;
  }
  status.innerHTML = loadingHtml("Searching");
  results.innerHTML = "";
  setNav({ home: false });
  try {
    const apiUrl = await getPdfSearchApiUrl();
    const boxQuery = folders.length
      ? `&boxes=${folders.map(encodeURIComponent).join(",")}`
      : "";
    const res = await authFetch(`${apiUrl}search?q=${encodeURIComponent(q)}${boxQuery}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const hits = filterHitsByFolders(data.hits || [], folders);
    const boxes = groupedBoxes(hits);
    status.textContent = hits.length
      ? `${hits.length} PDF${hits.length === 1 ? "" : "s"} in ${boxes.length} box${boxes.length === 1 ? "" : "es"}`
      : "No matches";
    setNav({ home: true });
    results.innerHTML = boxes.map((box) => `
      <section class="pdfsearch-hit-box">
        <h4 class="pdfsearch-hit-box-name">${escapeHtml(box.folder)}</h4>
        ${box.docs.map((h) => hitCard(h)).join("")}
      </section>
    `).join("");
  } catch (e) {
    if (isAuthError(e)) {
      await initPdfSearch();
      return;
    }
    status.textContent = e.message || "Search failed";
    setNav({ home: true });
  }
}

function setNav({ home, boxes } = {}) {
  if (home !== undefined) {
    const homeBtn = document.getElementById("pdfsearch-home");
    if (homeBtn) homeBtn.style.display = home ? "" : "none";
  }
  if (boxes !== undefined) {
    const boxesBtn = document.getElementById("pdfsearch-boxes");
    if (boxesBtn) boxesBtn.style.display = boxes ? "" : "none";
  }
}

function clearSearch() {
  const q = document.getElementById("pdfsearch-q");
  if (q) q.value = "";
  const results = document.getElementById("pdfsearch-results");
  if (results) results.innerHTML = "";
  const status = document.getElementById("pdfsearch-search-status");
  if (status) status.textContent = boxesAndPdfsStatus();
  hideSuggest();
  setNav({ home: false });
}

async function goHome() {
  clearSearch();
}

let suggestTimer = 0;
let suggestItems = [];
let suggestIndex = -1;
let suggestTicket = 0;

function suggestEl() {
  return document.getElementById("pdfsearch-suggest");
}

function hideSuggest() {
  const el = suggestEl();
  if (!el) return;
  el.hidden = true;
  el.classList.remove("is-open");
  el.innerHTML = "";
  suggestItems = [];
  suggestIndex = -1;
}

function renderSuggest(items) {
  const el = suggestEl();
  if (!el) return;
  suggestItems = items || [];
  suggestIndex = -1;
  if (!suggestItems.length) {
    hideSuggest();
    return;
  }
  el.innerHTML = suggestItems.map((s, i) => {
    const label = escapeHtml(s.display || s.term);
    const extra = s.count
      ? `<span class="pdfsearch-suggest-count">${escapeHtml(String(s.count))}</span>`
      : (s.kind === "box" ? `<span class="pdfsearch-suggest-kind">box</span>`
        : s.kind === "doc" ? `<span class="pdfsearch-suggest-kind">PDF</span>` : "");
    return `<li><button type="button" data-suggest-index="${i}">${label}${extra}</button></li>`;
  }).join("");
  el.hidden = false;
  el.classList.add("is-open");
}

function highlightSuggest(index) {
  const el = suggestEl();
  if (!el) return;
  suggestIndex = index;
  el.querySelectorAll("button").forEach((btn, i) => {
    btn.classList.toggle("is-active", i === index);
  });
}

async function applySuggest(index) {
  const item = suggestItems[index];
  if (!item) return;
  const q = document.getElementById("pdfsearch-q");
  hideSuggest();
  if (item.kind === "box") {
    if (q) q.value = "";
    setArchivesPanel("browse");
    showFolder(item.folder);
    return;
  }
  if (item.kind === "doc" && item.key) {
    if (q) q.value = "";
    const doc = catalogDocs.find((d) => d.key === item.key);
    setArchivesPanel("browse");
    showFolder(folderOf(doc || {}), item.key);
    return;
  }
  if (q) q.value = item.display || item.term;
  await runSearch();
}

function localSuggest(q) {
  const prefix = q.toLowerCase();
  const boxes = [];
  const docs = [];
  for (const box of groupedBoxes(catalogDocs)) {
    if (box.folder.toLowerCase().includes(prefix)) {
      boxes.push({
        kind: "box",
        display: box.folder,
        folder: box.folder,
        count: `${box.docs.length} PDF${box.docs.length === 1 ? "" : "s"}`,
      });
    }
    for (const d of box.docs) {
      const label = catalogLabel(d);
      const hay = `${label} ${d.description || ""}`.toLowerCase();
      if (!hay.includes(prefix)) continue;
      docs.push({ kind: "doc", display: label, key: d.key });
    }
  }
  return { boxes: boxes.slice(0, 3), docs: docs.slice(0, 4) };
}

function mergeSuggest(q, terms) {
  const local = localSuggest(q);
  const merged = [...local.boxes, ...local.docs];
  const seen = new Set(merged.map((i) => `${i.kind}:${String(i.display || "").toLowerCase()}`));
  for (const s of terms || []) {
    const display = s.display || s.term;
    const id = `term:${String(display || "").toLowerCase()}`;
    if (seen.has(id) || seen.has(`box:${String(display || "").toLowerCase()}`)) continue;
    merged.push({
      kind: "term",
      display,
      term: s.term,
      count: s.count,
    });
    seen.add(id);
    if (merged.length >= 10) break;
  }
  return merged.slice(0, 10);
}

async function fetchSuggest(q) {
  const ticket = ++suggestTicket;
  let terms = [];
  try {
    const apiUrl = await getPdfSearchApiUrl();
    const res = await authFetch(`${apiUrl}suggest?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    terms = data.suggestions || [];
  } catch (e) {
    if (ticket !== suggestTicket) return;
    if (isAuthError(e)) {
      hideSuggest();
      await initPdfSearch();
      return;
    }
  }
  if (ticket !== suggestTicket) return;
  renderSuggest(mergeSuggest(q, terms));
}

function wireSearchSuggest() {
  const input = document.getElementById("pdfsearch-q");
  const el = suggestEl();
  if (!input || input.dataset.suggestWired) return;
  input.dataset.suggestWired = "1";

  input.addEventListener("input", () => {
    window.clearTimeout(suggestTimer);
    suggestTimer = window.setTimeout(() => {
      const q = input.value.trim();
      if (q.length < 2) {
        hideSuggest();
        return;
      }
      fetchSuggest(q);
    }, 180);
  });
  input.addEventListener("focus", () => {
    const q = input.value.trim();
    if (q.length < 2) return;
    fetchSuggest(q);
  });
  input.addEventListener("keydown", (e) => {
    if (el?.hidden || !suggestItems.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightSuggest(Math.min(suggestItems.length - 1, suggestIndex + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightSuggest(Math.max(0, suggestIndex <= 0 ? 0 : suggestIndex - 1));
    } else if (e.key === "Enter" && suggestIndex >= 0) {
      e.preventDefault();
      applySuggest(suggestIndex);
    } else if (e.key === "Escape") {
      hideSuggest();
    }
  });

  el?.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest("[data-suggest-index]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    applySuggest(Number(btn.getAttribute("data-suggest-index")));
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest(".pdfsearch-suggest-wrap")) return;
    hideSuggest();
  });
}

function catalogLabel(doc) {
  const folder = (doc.folder || doc.box || "").trim();
  const name = doc.filename || "";
  return folder ? `${folder} / ${name}` : name;
}

function markClampedDescriptions() {
  document.querySelectorAll("#pdfsearch-catalog .pdfsearch-desc").forEach((el) => {
    el.classList.remove("is-clamped", "is-expanded");
    el.removeAttribute("tabindex");
    el.removeAttribute("role");
    el.removeAttribute("title");
    if (el.scrollHeight > el.clientHeight + 1) {
      el.classList.add("is-clamped");
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.title = "Show full description";
    }
  });
}

function wireCatalogDescExpand() {
  const list = document.getElementById("pdfsearch-catalog");
  if (!list || list.dataset.descWired) return;
  list.dataset.descWired = "1";
  list.addEventListener("click", (e) => {
    const folderBtn = e.target.closest(".pdfsearch-folder");
    if (folderBtn && list.contains(folderBtn)) {
      e.preventDefault();
      showFolder(folderBtn.getAttribute("data-folder") || "");
      return;
    }
    const desc = e.target.closest(".pdfsearch-desc");
    if (!desc || !list.contains(desc)) return;
    if (!desc.classList.contains("is-clamped") && !desc.classList.contains("is-expanded")) return;
    const open = desc.classList.toggle("is-expanded");
    desc.title = open ? "Hide full description" : "Show full description";
  });
  list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const folderBtn = e.target.closest(".pdfsearch-folder");
    if (folderBtn) return;
    const desc = e.target.closest(".pdfsearch-desc");
    if (!desc) return;
    e.preventDefault();
    desc.click();
  });
}

function boxRow(box) {
  const count = box.docs.length;
  return `<li class="pdfsearch-doc">
    <div class="pdfsearch-doc-head">
      <button type="button" class="pdfsearch-folder pdfsearch-open" data-folder="${escapeAttr(box.folder)}" title="Open box">${escapeHtml(box.folder)}</button>
      <span class="pdfsearch-meta"> · ${count} PDF${count === 1 ? "" : "s"}</span>
    </div>
  </li>`;
}

function catalogRow(doc, opts = {}) {
  const badge = doc.status === "READY" ? "" : ` <span class="pdfsearch-badge">${escapeHtml(doc.status || "pending")}</span>`;
  const pages = doc.pageCount ? ` · ${doc.pageCount} pages` : "";
  const desc = doc.description
    ? `<span class="pdfsearch-desc">${escapeHtml(doc.description)}</span>`
    : "";
  const title = opts.inFolder ? (doc.filename || "") : catalogLabel(doc);
  return `<li class="pdfsearch-doc">
    <div class="pdfsearch-doc-head">
      <button type="button" class="pdfsearch-open" data-key="${escapeAttr(doc.key)}" title="Open source PDF">${escapeHtml(title)}</button>
      <span class="pdfsearch-meta">${pages}${badge}</span>
    </div>
    ${desc}
  </li>`;
}

function hitCard(hit) {
  const key = escapeAttr(hit.key);
  const matches = (hit.matches || []).map((m) =>
    `<button type="button" class="pdfsearch-open pdfsearch-snippet" data-key="${key}" data-page="${escapeAttr(m.page)}" title="Open page ${escapeAttr(m.page)}">
      <span class="pdfsearch-page">p. ${escapeHtml(m.page)}</span> ${escapeHtml(m.snippet)}
    </button>`
  ).join("");
  return `<article class="pdfsearch-hit">
    <button type="button" class="pdfsearch-open" data-key="${key}" title="Open source PDF">${escapeHtml(hit.filename)}</button>
    ${matches}
  </article>`;
}

function formatExtractDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderExtractList(extracts) {
  const list = document.getElementById("pdfsearch-extract-all");
  const status = document.getElementById("pdfsearch-browse-status");
  const rows = Array.isArray(extracts) ? extracts : [];
  if (status) {
    status.dataset.mode = "extracts";
    status.textContent = rows.length
      ? `${rows.length} extract${rows.length === 1 ? "" : "s"}`
      : "No extracts";
  }
  if (!list) return;
  list.innerHTML = rows.map((item) => {
    const when = formatExtractDate(item.createdAt);
    const label = `${item.folder || ""} · ${item.filename || ""} · p. ${item.page}${when ? ` · ${when}` : ""}`;
    return `<li class="pdfsearch-extract-row" data-extract-key="${escapeAttr(item.key)}">
      <input type="checkbox" class="pdfsearch-extract-check" data-key="${escapeAttr(item.key)}" aria-label="Select extract" />
      <span class="pdfsearch-extract-label">${escapeHtml(label)}</span>
      <span class="pdfsearch-extract-row-actions">
        <button type="button" class="pdfsearch-extract-print" data-key="${escapeAttr(item.key)}">Clipboard</button>
      </span>
    </li>`;
  }).join("");
  syncExtractRemoveButtons();
}

async function showAllExtracts() {
  setBrowseMode("extracts");
  const status = document.getElementById("pdfsearch-browse-status");
  if (status) {
    status.dataset.mode = "extracts";
    status.textContent = "Loading extracts…";
  }
  const list = document.getElementById("pdfsearch-extract-all");
  if (list) list.innerHTML = "";
  try {
    const apiUrl = await getPdfSearchApiUrl();
    const res = await authFetch(`${apiUrl}extracts`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderExtractList(data.extracts || []);
  } catch (err) {
    if (isAuthError(err)) {
      await initPdfSearch();
      return;
    }
    if (status) status.textContent = err.message || "Could not load extracts";
  }
}

function fitPrintUrlField(field) {
  if (!field || field.hidden) return;
  field.style.height = "auto";
  const height = field.scrollHeight;
  if (height > 0) field.style.height = `${height}px`;
}

async function writeClipboard(text) {
  if (!text || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function showExtractUrlFallback(row, shareUrl) {
  let field = row.querySelector(".pdfsearch-extract-url");
  if (!field) {
    field = document.createElement("textarea");
    field.readOnly = true;
    field.rows = 1;
    field.className = "pdfsearch-extract-url";
    field.setAttribute("aria-label", "Print URL");
    row.appendChild(field);
  }
  field.hidden = false;
  field.value = shareUrl;
  fitPrintUrlField(field);
  field.focus();
  field.select();
}

async function printSavedExtract(key, row, button) {
  const apiUrl = await getPdfSearchApiUrl();
  const res = await authFetch(`${apiUrl}extracts?key=${encodeURIComponent(key)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  const shareUrl = extractPrintUrl([{ url: data.url || "", key: data.key || key }], window.location.href);
  if (!shareUrl) throw new Error("Could not make a print URL");
  const copied = await writeClipboard(shareUrl);
  const state = extractClipboardState(copied);
  if (button) button.textContent = state.label;
  const field = row?.querySelector(".pdfsearch-extract-url");
  if (!state.showUrl) {
    if (field) field.hidden = true;
    return;
  }
  if (row) showExtractUrlFallback(row, shareUrl);
}

function listedExtractKeys() {
  return [...document.querySelectorAll("#pdfsearch-extract-all .pdfsearch-extract-row")]
    .map((row) => row.getAttribute("data-extract-key") || "")
    .filter(Boolean);
}

function selectedExtractKeys() {
  return [...document.querySelectorAll("#pdfsearch-extract-all .pdfsearch-extract-check:checked")]
    .map((box) => box.getAttribute("data-key") || "")
    .filter(Boolean);
}

function syncExtractRemoveButtons() {
  const listed = listedExtractKeys();
  const selected = selectedExtractKeys();
  const selectAll = document.getElementById("pdfsearch-extract-select-all");
  const removeSelected = document.getElementById("pdfsearch-extract-remove-selected");
  if (selectAll) {
    selectAll.disabled = listed.length === 0;
    selectAll.checked = listed.length > 0 && selected.length === listed.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < listed.length;
  }
  if (removeSelected) removeSelected.disabled = selected.length === 0;
}

function updateExtractCount() {
  const list = document.getElementById("pdfsearch-extract-all");
  const left = list ? list.querySelectorAll(".pdfsearch-extract-row").length : 0;
  const status = document.getElementById("pdfsearch-browse-status");
  if (status?.dataset.mode === "extracts") {
    status.textContent = left ? `${left} extract${left === 1 ? "" : "s"}` : "No extracts";
  }
  syncExtractRemoveButtons();
}

async function deleteExtractKeys(keys) {
  const apiUrl = await getPdfSearchApiUrl();
  for (const key of keys) {
    const res = await authFetch(`${apiUrl}extracts?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    document.querySelector(`#pdfsearch-extract-all .pdfsearch-extract-row[data-extract-key="${CSS.escape(key)}"]`)?.remove();
  }
  updateExtractCount();
}

async function removeExtractSelection() {
  const keys = extractKeysToRemove(listedExtractKeys(), selectedExtractKeys());
  if (!keys.length) return;
  const message = keys.length === 1
    ? "Remove this extract? The print link will stop working."
    : `Remove ${keys.length} extracts? The print links will stop working.`;
  if (!window.confirm(message)) return;
  const removeSelected = document.getElementById("pdfsearch-extract-remove-selected");
  if (removeSelected) removeSelected.disabled = true;
  try {
    await deleteExtractKeys(keys);
  } catch (err) {
    updateExtractCount();
    if (isAuthError(err)) {
      await initPdfSearch();
      return;
    }
    const status = document.getElementById("pdfsearch-browse-status");
    if (status) status.textContent = err.message || "Could not remove extract";
  }
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#pdfsearch-extract-remove-selected")) {
    e.preventDefault();
    removeExtractSelection();
    return;
  }
  const extractPrintBtn = e.target.closest(".pdfsearch-extract-print");
  if (extractPrintBtn) {
    e.preventDefault();
    const key = extractPrintBtn.getAttribute("data-key");
    if (!key) return;
    extractPrintBtn.disabled = true;
    document.querySelectorAll(".pdfsearch-extract-print").forEach((btn) => {
      if (btn !== extractPrintBtn) btn.textContent = "Clipboard";
    });
    const row = extractPrintBtn.closest(".pdfsearch-extract-row");
    printSavedExtract(key, row, extractPrintBtn).catch(async (err) => {
      if (isAuthError(err)) {
        await initPdfSearch();
        return;
      }
      const status = document.getElementById("pdfsearch-browse-status");
      if (status) status.textContent = err.message || "Could not make a print URL";
    }).finally(() => {
      extractPrintBtn.disabled = false;
    });
    return;
  }
  const removeBtn = e.target.closest(".pdfsearch-remove");
  if (removeBtn) {
    e.preventDefault();
    const key = removeBtn.getAttribute("data-key");
    if (key) removePdf(key, removeBtn);
    return;
  }
  const btn = e.target.closest(".pdfsearch-open");
  if (!btn) return;
  const key = btn.getAttribute("data-key");
  if (!key) return;
  openSourcePdf(key, btn.getAttribute("data-page"));
});

let viewerLoad = 0;
let viewerDocKey = "";
let viewerPdfUrl = "";
let viewerPageHint = 1;
let pagedPdf = null;
let pagedPage = 1;
let pagedCount = 0;
let pdfjsLibPromise = null;

function needsPagedPdfViewer() {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  // Desktop Safari often leaves cross-origin PDFs blank in an iframe.
  if (/Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android/i.test(ua)) return true;
  return false;
}

async function getPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return pdfjsLibPromise;
}

function pdfHashBase() {
  const title = document.getElementById("pdfsearch-title")?.textContent || "";
  return /ancestry/i.test(title) ? "ancestry" : "pdfsearch";
}

function parseAppHash() {
  const raw = (location.hash || "").replace(/^#/, "");
  const q = raw.indexOf("?");
  const name = (q >= 0 ? raw.slice(0, q) : raw).split("/")[0];
  const params = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : "");
  return { name, params };
}

function openSourcePdf(key, page) {
  const params = new URLSearchParams();
  params.set("doc", key);
  const n = Number(page);
  if (Number.isFinite(n) && n >= 1) params.set("page", String(Math.floor(n)));
  const next = `${pdfHashBase()}?${params.toString()}`;
  if (location.hash.replace(/^#/, "") === next) {
    syncPdfSearchViewer();
    return;
  }
  location.hash = next;
}

async function syncPdfSearchViewer() {
  const { name, params } = parseAppHash();
  if (name !== "ancestry" && name !== "pdfsearch") {
    closePdfSearchViewer(false);
    return;
  }
  const key = params.get("doc");
  if (!key) {
    closePdfSearchViewer(false);
    return;
  }
  await loadViewer(key, params.get("page"));
}

function setPdfViewerProgress(show) {
  const progress = document.getElementById("pdfsearch-viewer-progress");
  if (progress) progress.hidden = !show;
}

async function loadViewer(key, page) {
  const overlay = document.getElementById("pdfsearch-viewer");
  const frame = document.getElementById("pdfsearch-viewer-frame");
  const title = document.getElementById("pdfsearch-viewer-title");
  const status = document.getElementById("pdfsearch-viewer-status");
  const progress = document.getElementById("pdfsearch-viewer-progress");
  if (!overlay || !frame) return;
  overlay.classList.add("is-open");
  viewerDocKey = key;
  viewerPageHint = Number(page);
  if (!Number.isFinite(viewerPageHint) || viewerPageHint < 1) viewerPageHint = 1;
  if (title) title.textContent = key.split("/").pop() || key;
  if (status) {
    status.textContent = "";
  }
  setExtractRange(viewerPageHint);
  syncExtractMode();
  setExtractPrint([]);
  setExtractPanel(false);
  if (progress) progress.hidden = false;
  const ticket = ++viewerLoad;
  frame.removeAttribute("src");
  const paged = needsPagedPdfViewer();
  overlay.classList.toggle("is-paged", paged);
  setPagedNavVisible(paged);
  try {
    const apiUrl = await getPdfSearchApiUrl();
    const res = await authFetch(`${apiUrl}documents?key=${encodeURIComponent(key)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    viewerPdfUrl = data.url || "";
    if (ticket !== viewerLoad) return;
    if (paged) {
      await loadPagedPdf(data.url, page, ticket, status);
      setPdfViewerProgress(false);
      return;
    }
    frame.onload = () => {
      if (ticket !== viewerLoad) return;
      setPdfViewerProgress(false);
    };
    frame.src = withPdfPage(data.url, page);
    const n = Number(page);
    const shown = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
    setViewerPageInput(shown, knownPageCount(key));
    setViewerPageLabel(knownPageCount(key) ? `${shown} / ${knownPageCount(key)}` : `Page ${shown}`);
  } catch (err) {
    if (ticket !== viewerLoad) return;
    setPdfViewerProgress(false);
    if (isAuthError(err)) {
      overlay.classList.remove("is-open");
      await initPdfSearch();
      return;
    }
    if (status) status.textContent = err.message || "Could not open document";
  }
}

function setPagedNavVisible(show) {
  const prev = document.getElementById("pdfsearch-viewer-prev");
  const next = document.getElementById("pdfsearch-viewer-next");
  if (prev) prev.style.display = show ? "" : "none";
  if (next) next.style.display = show ? "" : "none";
}

async function loadPagedPdf(url, page, ticket, status) {
  await destroyPagedPdf();
  const pdfjs = await getPdfjs();
  if (ticket !== viewerLoad) return;
  const loading = pdfjs.getDocument({
    url,
    disableRange: true,
    disableStream: true,
  });
  pagedPdf = await loading.promise;
  if (ticket !== viewerLoad) {
    await destroyPagedPdf();
    return;
  }
  pagedCount = pagedPdf.numPages || 1;
  const start = Number(page);
  pagedPage = Number.isFinite(start) && start >= 1 ? Math.min(Math.floor(start), pagedCount) : 1;
  bindPagedSwipe();
  await showPagedPage(pagedPage);
}

async function showPagedPage(pageNum) {
  if (!pagedPdf) return;
  const next = Math.min(pagedCount, Math.max(1, Number(pageNum) || 1));
  pagedPage = next;
  viewerPageHint = pagedPage;
  const status = document.getElementById("pdfsearch-viewer-status");
  const prevBtn = document.getElementById("pdfsearch-viewer-prev");
  const nextBtn = document.getElementById("pdfsearch-viewer-next");
  if (prevBtn) prevBtn.disabled = pagedPage <= 1;
  if (nextBtn) nextBtn.disabled = pagedPage >= pagedCount;
  setViewerPageLabel(`${pagedPage} / ${pagedCount}`);
  setViewerPageInput(pagedPage, pagedCount);
  rememberViewerPage(pagedPage);
  const scroll = document.getElementById("pdfsearch-viewer-scroll");
  if (!scroll) return;
  const page = await pagedPdf.getPage(pagedPage);
  const base = page.getViewport({ scale: 1 });
  const width = Math.max(280, (scroll.clientWidth || window.innerWidth) - 16);
  const scale = width / base.width;
  const viewport = page.getViewport({ scale: Math.min(scale, 3) });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = "100%";
  scroll.replaceChildren(canvas);
  await page.render({ canvasContext: ctx, viewport }).promise;
}

function bindPagedSwipe() {
  const pages = document.getElementById("pdfsearch-viewer-pages");
  if (!pages || pages.dataset.swipeBound) return;
  pages.dataset.swipeBound = "1";
  let startX = null;
  pages.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) {
      startX = null;
      return;
    }
    startX = e.touches[0].clientX;
  }, { passive: true });
  pages.addEventListener("touchend", (e) => {
    if (startX == null || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (dx < -40) showPagedPage(pagedPage + 1);
    else if (dx > 40) showPagedPage(pagedPage - 1);
  }, { passive: true });
}

async function destroyPagedPdf() {
  const scroll = document.getElementById("pdfsearch-viewer-scroll");
  if (scroll) scroll.replaceChildren();
  if (pagedPdf) {
    try { await pagedPdf.destroy(); } catch { /* ignore */ }
  }
  pagedPdf = null;
  pagedPage = 1;
  pagedCount = 0;
}

function setViewerPageLabel(text) {
  const status = document.getElementById("pdfsearch-viewer-status");
  if (!status) return;
  status.textContent = text;
}

function knownPageCount(key) {
  const doc = catalogDocs.find((item) => item.key === key);
  const n = Math.floor(Number(doc?.pageCount));
  return Number.isFinite(n) && n >= 1 ? n : 0;
}

function setViewerPageInput(page, count) {
  const input = document.getElementById("pdfsearch-viewer-page");
  if (!input) return;
  const n = Math.floor(Number(page));
  if (Number.isFinite(n) && n >= 1) input.value = String(n);
  const total = Math.floor(Number(count));
  if (Number.isFinite(total) && total >= 1) input.max = String(total);
  else input.removeAttribute("max");
}

function rememberViewerPage(page) {
  const { name, params } = parseAppHash();
  if ((name !== "ancestry" && name !== "pdfsearch") || !params.get("doc")) return;
  params.set("page", String(page));
  const next = `${name}?${params.toString()}`;
  if (location.hash.replace(/^#/, "") === next) return;
  history.replaceState(null, "", `#${next}`);
}

function goToViewerPage(raw) {
  let n = Math.floor(Number(raw));
  const total = pagedPdf ? pagedCount : knownPageCount(viewerDocKey);
  if (!Number.isFinite(n) || n < 1) {
    setViewerPageInput(pagedPdf ? pagedPage : viewerPageHint, total);
    return;
  }
  if (total >= 1) n = Math.min(n, total);
  if (pagedPdf) {
    showPagedPage(n);
    return;
  }
  if (!viewerPdfUrl) return;
  viewerPageHint = n;
  setExtractRange(n);
  setViewerPageInput(n, total);
  setViewerPageLabel(total ? `${n} / ${total}` : `Page ${n}`);
  rememberViewerPage(n);
  const frame = document.getElementById("pdfsearch-viewer-frame");
  if (!frame) return;
  const nextSrc = withPdfPage(viewerPdfUrl, n);
  if (frame.src.split("#")[0] === nextSrc.split("#")[0] && frame.src.includes(`#page=${n}`)) return;
  setPdfViewerProgress(true);
  frame.onload = () => setPdfViewerProgress(false);
  frame.src = nextSrc;
}

function setExtractRange(page) {
  const n = Math.floor(Number(page));
  if (!Number.isFinite(n) || n < 1) return;
  const from = document.getElementById("pdfsearch-viewer-extract-from");
  const to = document.getElementById("pdfsearch-viewer-extract-to");
  if (from) from.value = String(n);
  if (to) to.value = String(n);
}

function syncExtractMode() {
  const mode = document.getElementById("pdfsearch-viewer-extract-mode")?.value;
  const range = document.getElementById("pdfsearch-viewer-extract-range");
  if (range) range.hidden = mode === "all";
}

function setExtractPanel(open) {
  const overlay = document.getElementById("pdfsearch-viewer-extract-overlay");
  const button = document.getElementById("pdfsearch-viewer-extract");
  if (overlay) overlay.hidden = !open;
  if (button) button.setAttribute("aria-expanded", open ? "true" : "false");
}

function onExtractClick() {
  const overlay = document.getElementById("pdfsearch-viewer-extract-overlay");
  if (extractOverlayAction(Boolean(overlay?.hidden)) === "open") {
    setExtractRange(pagedPdf ? pagedPage : viewerPageHint);
    setExtractPanel(true);
    return;
  }
  extractViewerSelection();
}

function canvasToJpeg(canvas, quality = 0.85) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not make JPEG"));
    }, "image/jpeg", quality);
  });
}

async function renderPdfPageJpeg(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw page");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvasToJpeg(canvas);
}

async function uploadExtractPage(sourceKey, pageNum, blob) {
  const apiUrl = await getPdfSearchApiUrl();
  const res = await authFetch(`${apiUrl}extracts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceKey,
      page: pageNum,
      contentType: "image/jpeg",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  await putObject(data.url, blob, "image/jpeg");
  return { url: data.getUrl || "", key: data.key || "" };
}

let savedExtractItems = [];

function setExtractPrint(items) {
  savedExtractItems = Array.isArray(items) ? items : [];
  const printBtn = document.getElementById("pdfsearch-viewer-print");
  const urlInput = document.getElementById("pdfsearch-viewer-print-url");
  const note = document.getElementById("pdfsearch-viewer-extract-note");
  const shareUrl = extractPrintUrl(savedExtractItems, window.location.href);
  if (printBtn) {
    printBtn.hidden = !shareUrl;
    printBtn.disabled = !shareUrl;
    printBtn.textContent = "Clipboard";
  }
  if (urlInput) {
    urlInput.hidden = true;
    urlInput.value = shareUrl;
  }
  if (!note) return;
  if (!savedExtractItems.length) note.textContent = "";
  else if (!shareUrl) note.textContent = "Could not make a print URL.";
  else note.textContent = "Saved.";
}

async function copyExtractPrintUrl() {
  const field = document.getElementById("pdfsearch-viewer-print-url");
  const button = document.getElementById("pdfsearch-viewer-print");
  const note = document.getElementById("pdfsearch-viewer-extract-note");
  const href = field?.value || "";
  if (!href) return;
  const copied = await writeClipboard(href);
  const state = extractClipboardState(copied);
  if (button) button.textContent = state.label;
  if (!state.showUrl) {
    if (field) field.hidden = true;
    if (note) note.textContent = "Copied.";
    return;
  }
  if (field) {
    field.hidden = false;
    fitPrintUrlField(field);
    field.focus();
    field.select();
  }
  if (note) note.textContent = "Select the URL to copy it.";
}

function showSavedExtract(items) {
  setExtractPrint(items);
  setExtractPanel(true);
}

async function withViewerPdf(fn) {
  if (pagedPdf) return fn(pagedPdf);
  if (!viewerPdfUrl) throw new Error("PDF is not loaded");
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({
    url: viewerPdfUrl,
    disableRange: true,
    disableStream: true,
  }).promise;
  try {
    return await fn(pdf);
  } finally {
    try { await pdf.destroy(); } catch { /* ignore */ }
  }
}

let extractBusy = false;

async function extractViewerSelection() {
  if (extractBusy || !viewerDocKey) return;
  const status = document.getElementById("pdfsearch-viewer-status");
  const btn = document.getElementById("pdfsearch-viewer-extract");
  const printBtn = document.getElementById("pdfsearch-viewer-print");
  const mode = document.getElementById("pdfsearch-viewer-extract-mode")?.value || "pages";
  const from = document.getElementById("pdfsearch-viewer-extract-from")?.value;
  const to = document.getElementById("pdfsearch-viewer-extract-to")?.value;
  extractBusy = true;
  setExtractPrint([]);
  if (btn) btn.disabled = true;
  if (printBtn) printBtn.disabled = true;
  if (status) status.textContent = "Extracting…";
  const saved = [];
  try {
    await withViewerPdf(async (pdf) => {
      const choice = extractPageList(mode, from, to, pdf.numPages || 0);
      if (choice.error) throw new Error(choice.error);
      const fromInput = document.getElementById("pdfsearch-viewer-extract-from");
      const toInput = document.getElementById("pdfsearch-viewer-extract-to");
      if (fromInput) fromInput.max = String(pdf.numPages || 1);
      if (toInput) toInput.max = String(pdf.numPages || 1);
      for (let i = 0; i < choice.pages.length; i++) {
        const pageNum = choice.pages[i];
        if (status) status.textContent = `Extracting page ${pageNum} (${i + 1} of ${choice.pages.length})`;
        const blob = await renderPdfPageJpeg(pdf, pageNum);
        const savedItem = await uploadExtractPage(viewerDocKey, pageNum, blob);
        if (savedItem.url) saved.push(savedItem);
      }
    });
    if (!saved.length) throw new Error("Extract failed");
    showSavedExtract(saved);
  } catch (err) {
    if (isAuthError(err)) {
      closePdfSearchViewer(true);
      await initPdfSearch();
      return;
    }
    if (saved.length) {
      showSavedExtract(saved);
      status?.insertAdjacentText("beforeend", ` Stopped: ${err.message || "Extract failed"}`);
    } else if (status) status.textContent = err.message || "Extract failed";
  } finally {
    extractBusy = false;
    if (btn) btn.disabled = false;
  }
}

function safePdfFilename(name) {
  const base = String(name || "document.pdf").split(/[/\\]/).pop() || "document.pdf";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_");
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

let ocrPollTimer = 0;
const OCR_POLL_MS = 4000;
const OCR_POLL_MAX_MS = 15 * 60 * 1000;

function stopOcrPoll() {
  if (ocrPollTimer) {
    clearTimeout(ocrPollTimer);
    ocrPollTimer = 0;
  }
}

function setUploadStatus(text) {
  const status = document.getElementById("pdfsearch-upload-status");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("is-failed", /failed/i.test(text));
}

function ocrLabel(row) {
  if (row.status === "READY") {
    const n = row.pageCount || 0;
    return `${row.key} ready (${n} page${n === 1 ? "" : "s"})`;
  }
  if (row.status === "OCR_STARTED") return `${row.key} OCR in progress`;
  if (row.status === "OCR_FAILED") return `${row.key} OCR failed`;
  return `${row.key} waiting for OCR`;
}

function startOcrPoll(keys) {
  stopOcrPoll();
  const wanted = [...new Set((keys || []).filter(Boolean))];
  if (!wanted.length) return;
  const t0 = Date.now();
  const tick = async () => {
    const statusEl = document.getElementById("pdfsearch-upload-status");
    try {
      const apiUrl = await getPdfSearchApiUrl();
      const res = await authFetch(`${apiUrl}search`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const byKey = new Map((data.documents || []).filter((d) => d.key).map((d) => [d.key, d]));
      const rows = wanted.map((key) => {
        const doc = byKey.get(key);
        return { key, status: doc?.status || "WAITING", pageCount: doc?.pageCount || 0 };
      });
      console.log("[ancestry-ocr] poll", rows);
      const failed = rows.filter((r) => r.status === "OCR_FAILED");
      const ready = rows.filter((r) => r.status === "READY");
      const started = rows.filter((r) => r.status === "OCR_STARTED");
      if (statusEl) {
        if (rows.length === 1) setUploadStatus(ocrLabel(rows[0]));
        else if (failed.length) setUploadStatus(failed.map(ocrLabel).join(" · "));
        else if (ready.length === rows.length) {
          setUploadStatus(`Ready — ${ready.length} PDFs.`);
        } else {
          setUploadStatus(`OCR ${ready.length} ready, ${started.length} in progress, ${rows.length - ready.length - started.length} waiting…`);
        }
      }
      if (failed.length || ready.length === rows.length) {
        stopOcrPoll();
        const folder = wanted[0].split("/")[0];
        await loadCatalog();
        if (folder && groupedBoxes(catalogDocs).some((b) => b.folder === folder)) {
          showFolder(folder);
        } else if (folder) {
          setAddBoxName(folder);
        }
        if (statusEl && ready.length === rows.length && !failed.length) {
          const pages = ready.reduce((n, r) => n + (r.pageCount || 0), 0);
          setUploadStatus(rows.length === 1
            ? `Ready — ${pages} page${pages === 1 ? "" : "s"}.`
            : `Ready — ${ready.length} PDFs (${pages} pages).`);
        }
        return;
      }
    } catch (err) {
      if (isAuthError(err)) {
        stopOcrPoll();
        await initPdfSearch();
        return;
      }
      console.log("[ancestry-ocr] poll error", err?.message || err);
    }
    if (Date.now() - t0 > OCR_POLL_MAX_MS) {
      if (statusEl) setUploadStatus("OCR is still running. Try Search in a few minutes.");
      stopOcrPoll();
      return;
    }
    ocrPollTimer = setTimeout(tick, OCR_POLL_MS);
  };
  ocrPollTimer = setTimeout(tick, 1500);
}

async function uploadPdfsToArchive(files) {
  stopOcrPoll();
  const nameInput = document.getElementById("pdfsearch-add-box-name");
  const addBoxSel = document.getElementById("pdfsearch-add-box-select");
  const pdfs = [...(files || [])].filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
  let folder = "";
  try {
    folder = resolvePdfUploadFolder(addBoxSel?.value, nameInput?.value, existingBoxNames());
  } catch (err) {
    setUploadStatus(err.message || "Name the box first.");
    return;
  }
  if (!pdfs.length) {
    setUploadStatus("Choose a PDF.");
    return;
  }
  const uploadInput = document.getElementById("pdfsearch-upload-input");
  const uploadBtn = document.getElementById("pdfsearch-upload-btn");
  if (addBoxSel) addBoxSel.disabled = true;
  if (nameInput) nameInput.disabled = true;
  if (uploadInput) uploadInput.disabled = true;
  if (uploadBtn) uploadBtn.disabled = true;
  const apiUrl = await getPdfSearchApiUrl();
  const uploadedKeys = [];
  try {
    for (const file of pdfs) {
      const key = `${folder}/${safePdfFilename(file.name)}`;
      uploadedKeys.push(key);
      const partCount = Math.max(1, Math.ceil(file.size / (8 * 1024 * 1024)));
      console.log("[ancestry-upload] begin", {
        file: file.name,
        key,
        bytes: file.size,
        sizeMB: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        parts: partCount,
      });
      setUploadStatus(`Uploading ${file.name} — ${partCount} part${partCount === 1 ? "" : "s"} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);
      await putMultipart(file, {
        initiate: async ({ contentType }) => {
          const res = await authFetch(`${apiUrl}uploads`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, contentType }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          return data;
        },
        signPart: async ({ key: partKey, uploadId, partNumber }) => {
          const res = await authFetch(`${apiUrl}uploads/parts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: partKey, uploadId, partNumber }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          return data;
        },
        complete: async ({ key: partKey, uploadId, parts }) => {
          const res = await authFetch(`${apiUrl}uploads/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: partKey, uploadId, parts }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          return data;
        },
        abort: async ({ key: partKey, uploadId }) => {
          console.log("[ancestry-upload] abort", { key: partKey, uploadId });
          await authFetch(`${apiUrl}uploads/abort`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: partKey, uploadId }),
          });
        },
      }, {
        contentType: "application/pdf",
        onProgress: (part, total, info) => {
          const partMB = info?.bytes ? (info.bytes / (1024 * 1024)).toFixed(1) : "?";
          const ms = info?.ms != null ? ` in ${info.ms} ms` : "";
          setUploadStatus(`Uploading ${file.name} — part ${part} of ${total} (${partMB} MB${ms})`);
          console.log("[ancestry-upload] part", {
            file: file.name,
            key,
            part,
            total,
            bytes: info?.bytes,
            etag: info?.etag,
            ms: info?.ms,
          });
        },
      });
      console.log("[ancestry-upload] finished", { file: file.name, key });
    }
    setUploadStatus("Uploaded. Waiting for OCR to start…");
    setAddBoxName(folder);
    startOcrPoll(uploadedKeys);
  } catch (err) {
    if (isAuthError(err)) {
      await initPdfSearch();
      return;
    }
    setUploadStatus(err.message || "Upload failed");
  } finally {
    if (addBoxSel) addBoxSel.disabled = false;
    if (nameInput) nameInput.disabled = false;
    if (uploadInput) uploadInput.disabled = false;
    if (uploadBtn) uploadBtn.disabled = false;
  }
}

function closePdfSearchViewer(updateHash) {
  viewerLoad += 1;
  const overlay = document.getElementById("pdfsearch-viewer");
  const frame = document.getElementById("pdfsearch-viewer-frame");
  overlay?.classList.remove("is-open");
  overlay?.classList.remove("is-paged");
  setPagedNavVisible(false);
  setPdfViewerProgress(false);
  setExtractPanel(false);
  if (frame) frame.src = "about:blank";
  destroyPagedPdf();
  viewerDocKey = "";
  viewerPdfUrl = "";
  viewerPageHint = 1;
  setViewerPageInput(1, 0);
  if (!updateHash) return;
  const { name } = parseAppHash();
  if (name === "ancestry" || name === "pdfsearch") {
    location.hash = pdfHashBase();
  }
}

function withPdfPage(url, page) {
  const n = Number(page);
  if (!Number.isFinite(n) || n < 1) return url;
  return `${url}#page=${Math.floor(n)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

window.initPdfSearch = initPdfSearch;
window.runPdfSearch = runSearch;
window.syncPdfSearchViewer = syncPdfSearchViewer;
window.closePdfSearchViewer = closePdfSearchViewer;

syncExtractMode();
setExtractPrint([]);
setExtractPanel(false);
document.getElementById("pdfsearch-viewer-extract-mode")?.addEventListener("change", syncExtractMode);
document.getElementById("pdfsearch-viewer-extract")?.addEventListener("click", onExtractClick);
document.getElementById("pdfsearch-viewer-print")?.addEventListener("click", () => {
  copyExtractPrintUrl();
});
document.getElementById("pdfsearch-viewer-print-url")?.addEventListener("click", () => {
  copyExtractPrintUrl();
});
document.getElementById("pdfsearch-extract-select-all")?.addEventListener("change", (e) => {
  const checked = e.target.checked;
  document.querySelectorAll("#pdfsearch-extract-all .pdfsearch-extract-check").forEach((box) => {
    box.checked = checked;
  });
  syncExtractRemoveButtons();
});
document.getElementById("pdfsearch-extract-all")?.addEventListener("change", (e) => {
  if (!e.target.classList?.contains("pdfsearch-extract-check")) return;
  syncExtractRemoveButtons();
});
document.getElementById("pdfsearch-viewer-extract-overlay")?.addEventListener("click", (e) => {
  if (e.target.id !== "pdfsearch-viewer-extract-overlay") return;
  setExtractPanel(false);
});

await syncAncestryNav();
