// albumSlideShow.js — reads API URL from dliv_outputs.json (dropbox-893 /albums API)

let ALBUMS_URL = '';
let PHOTOS_URL_BASE = '';

function normalizeApiBase(url) {
  if (!url || typeof url !== 'string') return '';
  const t = url.trim();
  return t.endsWith('/') ? t : `${t}/`;
}

async function loadConfig() {
  const confRes = await fetch(`/dliv_outputs.json?_=${Date.now()}`, {
    cache: 'no-store',
  });
  if (!confRes.ok) {
    throw new Error(`Could not load dliv_outputs.json (${confRes.status})`);
  }
  const outputs = await confRes.json();
  const rawUrl =
    outputs.slideshow?.api_url || outputs.dropbox?.api_url || '';
  const base = normalizeApiBase(rawUrl);
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error(
      'slideshow.api_url / dropbox.api_url missing or not absolute. Set DROPBOX_API_URL (and optionally SLIDESHOW_API_URL) on the Amplify app environment variables, then redeploy.'
    );
  }
  ALBUMS_URL = `${base}albums`;
  PHOTOS_URL_BASE = `${base}albums/`;
}

/** Unwrap only API Gateway Lambda-proxy JSON (`statusCode` + string `body`). Avoid replacing `{ albums }` when an unrelated string `body` exists alongside valid albums. */
function unwrapLambdaProxyEnvelope(parsed) {
  if (
    parsed &&
    typeof parsed === 'object' &&
    typeof parsed.statusCode === 'number' &&
    typeof parsed.body === 'string'
  ) {
    try {
      const inner = JSON.parse(parsed.body);
      return inner && typeof inner === 'object' ? inner : parsed;
    } catch {
      return parsed;
    }
  }
  /* Rare: proxy-shaped body without statusCode — only use inner JSON if top-level has no albums[]. */
  if (
    parsed &&
    typeof parsed === 'object' &&
    typeof parsed.body === 'string' &&
    !Array.isArray(parsed.albums)
  ) {
    try {
      const inner = JSON.parse(parsed.body);
      if (inner && typeof inner === 'object' && Array.isArray(inner.albums)) {
        return inner;
      }
    } catch {
      /* ignore */
    }
  }
  return parsed;
}

/** Supports dropbox-893 shape `{ albums: [{ name, prefix }, ...] }` and legacy string[]. */
function parseAlbumNames(json) {
  if (Array.isArray(json)) {
    if (json.length === 0) return [];
    if (typeof json[0] === 'string') {
      return json.filter((x) => typeof x === 'string' && x);
    }
    return json
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a && typeof a.name === 'string') return a.name;
        if (a && typeof a.prefix === 'string') {
          const parts = a.prefix.replace(/\/$/, '').split('/').filter(Boolean);
          return parts.length ? parts[parts.length - 1] : '';
        }
        return '';
      })
      .filter(Boolean);
  }
  if (json && Array.isArray(json.albums)) {
    return json.albums
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a && typeof a.name === 'string') return a.name;
        if (a && typeof a.prefix === 'string') {
          const parts = a.prefix.replace(/\/$/, '').split('/').filter(Boolean);
          return parts.length ? parts[parts.length - 1] : '';
        }
        return '';
      })
      .filter(Boolean);
  }
  return [];
}

/** Supports `{ photos: [{ url }, ...] }` and legacy string[]. */
function parsePhotoUrls(json) {
  if (Array.isArray(json)) {
    return json
      .map((x) => (typeof x === 'string' ? x : x?.url))
      .filter(Boolean);
  }
  if (json && Array.isArray(json.photos)) {
    return json.photos
      .map((p) => (typeof p === 'string' ? p : p?.url))
      .filter(Boolean);
  }
  return [];
}

let allPhotos = [];
let currentIndex = 0;
let isPlaying = false;
let intervalId = null;
const SLIDE_INTERVAL_MS = 3000;

const photoAlbums = async () => {
  const url = `${ALBUMS_URL}${ALBUMS_URL.includes('?') ? '&' : '?'}_cb=${Date.now()}`;
  const response = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Albums request failed (${response.status})`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const ct = response.headers.get('content-type') || '';
    throw new Error(
      `Albums response was not JSON (${ct}). Start: ${text.slice(0, 160)}`
    );
  }
};

const loadAlbumSelector = async (selector) => {
  const headerMessage = document.getElementById('headerMessage');
  headerMessage.innerText = 'Getting Albums';
  try {
    const raw = await photoAlbums();
    if (raw && typeof raw.error === "string") {
      throw new Error(raw.error);
    }
    let payload = unwrapLambdaProxyEnvelope(raw);

    const names = parseAlbumNames(payload);
    if (names.length) {
      headerMessage.innerText = '';
      names.unshift('Pick or Stop');
      const selectAlbum = document.getElementById(selector);
      for (const name of names) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name === 'root' ? 'Photos (root)' : name;
        selectAlbum.appendChild(option);
      }
      selectAlbum.addEventListener('change', selectAlbumEventHandler, true);
    } else {
      console.warn('Slideshow /albums payload (empty album list):', payload);
      headerMessage.innerText =
        'No albums returned — check DevTools → Network → albums response matches curl (same URL).';
    }
  } catch (e) {
    console.error(e);
    headerMessage.innerText =
      e.message || 'Could not load albums — check slideshow API URL';
  }
};

const selectAlbumEventHandler = async (event) => {
  const headerMessage = document.getElementById('headerMessage');
  stopSlideshow();
  const albumName = event.target.value;
  if (albumName === 'Pick or Stop') {
    headerMessage.innerText = '';
    document.getElementById('slide').src = '';
    setControlsVisible(false);
    return;
  }
  headerMessage.innerText = `Getting pics in ${albumName}`;
  try {
    const url = PHOTOS_URL_BASE + encodeURIComponent(albumName);
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Photos request failed (${response.status})`);
    }
    const urls = parsePhotoUrls(JSON.parse(await response.text()));
    if (!urls.length) {
      headerMessage.innerText = 'No photos in this album';
      document.getElementById('slide').src = '';
      setControlsVisible(false);
      return;
    }
    startSlideshow(urls);
  } catch (e) {
    console.error(e);
    headerMessage.innerText =
      e.message || 'Could not load photos for this album';
    setControlsVisible(false);
  }
};

const startSlideshow = (photoUrls) => {
  allPhotos = photoUrls;
  currentIndex = 0;
  isPlaying = true;
  showPhoto(currentIndex);
  const headerMessage = document.getElementById('headerMessage');
  headerMessage.innerText = '';
  setControlsVisible(true);
  updatePlayPauseButton();
  scheduleNextSlide();
};

const scheduleNextSlide = () => {
  clearInterval(intervalId);
  if (isPlaying) {
    intervalId = setInterval(() => {
      if (currentIndex < allPhotos.length - 1) {
        currentIndex++;
        showPhoto(currentIndex);
      } else {
        stopSlideshow();
      }
    }, SLIDE_INTERVAL_MS);
  }
};

const showPhoto = (index) => {
  document.getElementById('slide').src = allPhotos[index];
};

const stopSlideshow = () => {
  clearInterval(intervalId);
  isPlaying = false;
  updatePlayPauseButton();
};

const setControlsVisible = (visible) => {
  document.getElementById('controls').style.display = visible ? 'flex' : 'none';
};

const updatePlayPauseButton = () => {
  const btn = document.getElementById('playPauseBtn');
  btn.textContent = isPlaying ? '⏸' : '▶';
  btn.title = isPlaying ? 'Pause' : 'Play';
};

document.addEventListener('DOMContentLoaded', async function () {
  try {
    await loadConfig();
    await loadAlbumSelector('selectAlbum');
  } catch (e) {
    console.error(e);
    const el = document.getElementById('headerMessage');
    if (el) el.innerText = e.message || String(e);
  }
  setControlsVisible(false);

  document.getElementById('playPauseBtn').addEventListener('click', () => {
    if (allPhotos.length === 0) return;
    isPlaying = !isPlaying;
    updatePlayPauseButton();
    if (isPlaying) scheduleNextSlide();
    else clearInterval(intervalId);
  });

  document.getElementById('prevBtn').addEventListener('click', () => {
    if (allPhotos.length === 0) return;
    clearInterval(intervalId);
    if (currentIndex > 0) {
      currentIndex--;
      showPhoto(currentIndex);
    }
    if (isPlaying) scheduleNextSlide();
  });

  document.getElementById('nextBtn').addEventListener('click', () => {
    if (allPhotos.length === 0) return;
    clearInterval(intervalId);
    if (currentIndex < allPhotos.length - 1) {
      currentIndex++;
      showPhoto(currentIndex);
    }
    if (isPlaying) scheduleNextSlide();
  });
});
