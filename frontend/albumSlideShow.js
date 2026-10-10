// albumSlideShow.js — reads API URL from dliv_outputs.json (dropbox-893 /albums API)

let ALBUMS_URL = '';
let PHOTOS_URL_BASE = '';
let SHARED_ALBUMS_URL = '';

function normalizeApiBase(url) {
  if (!url || typeof url !== 'string') return '';
  const t = url.trim();
  return t.endsWith('/') ? t : `${t}/`;
}

function loadingHtml(label) {
  const text = String(label || "Loading")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div class="apple-progress" role="status" aria-live="polite">
    <p class="apple-progress-label">${text}</p>
    <div class="apple-progress-track"><div class="apple-progress-bar"></div></div>
  </div>`;
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
  SHARED_ALBUMS_URL = `${base}shared-albums`;
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
  /* Rare: proxy-shaped body without statusCode — peel inner only if top-level has no albums[] / photos[]. */
  if (
    parsed &&
    typeof parsed === 'object' &&
    typeof parsed.body === 'string' &&
    !Array.isArray(parsed.albums) &&
    !Array.isArray(parsed.photos)
  ) {
    try {
      const inner = JSON.parse(parsed.body);
      if (
        inner &&
        typeof inner === 'object' &&
        (Array.isArray(inner.albums) || Array.isArray(inner.photos))
      ) {
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

/** Supports `{ photos: [{ url, caption }, ...] }` and legacy string[]. */
function parsePhotos(json) {
  const rows = Array.isArray(json) ? json : json && Array.isArray(json.photos) ? json.photos : [];
  return rows
    .map((p) => {
      if (typeof p === 'string') return { url: p, caption: '', filename: '' };
      const url = p?.url || '';
      if (!url) return null;
      return {
        url,
        caption: typeof p.caption === 'string' ? p.caption.trim() : '',
        filename: typeof p.filename === 'string' ? p.filename : '',
      };
    })
    .filter(Boolean);
}

let allPhotos = [];
let currentIndex = 0;
let isPlaying = false;
let intervalId = null;
let slideHasShownOnce = false;
let slideLoadTicket = 0;
const SLIDE_INTERVAL_MS = 3000;

function resetSlideElement() {
  const el = document.getElementById('slide');
  if (!el) return;
  slideHasShownOnce = false;
  slideLoadTicket++;
  el.hidden = true;
  el.removeAttribute('src');
  delete el.dataset.slideTicket;
  setCaption('');
}

function parsePhotosResponse(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Photos response was not JSON');
  }
  parsed = unwrapLambdaProxyEnvelope(parsed);
  if (parsed && typeof parsed.error === 'string') {
    throw new Error(parsed.error);
  }
  return parsePhotos(parsed);
}

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
  const status = document.getElementById('familyAlbumStatus');
  if (status) status.innerHTML = loadingHtml("Getting albums");
  try {
    const raw = await photoAlbums();
    if (raw && typeof raw.error === "string") {
      throw new Error(raw.error);
    }
    let payload = unwrapLambdaProxyEnvelope(raw);

    const names = parseAlbumNames(payload);
    const selectAlbum = document.getElementById(selector);
    if (!selectAlbum) return;
    selectAlbum.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Pick or Stop';
    selectAlbum.appendChild(placeholder);
    if (names.length) {
      if (status) status.textContent = '';
      for (const name of names) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name === 'root' ? 'Photos (root)' : name;
        selectAlbum.appendChild(option);
      }
      selectAlbum.addEventListener('change', selectAlbumEventHandler, true);
    } else {
      console.warn('Slideshow /albums payload (empty album list):', payload);
      if (status) {
        status.innerText =
          'No family albums returned.';
      }
    }
  } catch (e) {
    console.error(e);
    if (status) {
      status.innerText =
        e.message || 'Could not load albums — check slideshow API URL';
    }
  }
};

const selectAlbumEventHandler = async (event) => {
  const headerMessage = document.getElementById('headerMessage');
  stopSlideshow();
  const albumName = event.target.value;
  resetSharedSelect();
  if (!albumName) {
    headerMessage.innerText = '';
    resetSlideElement();
    setCaption('');
    setControlsVisible(false);
    return;
  }
  headerMessage.innerHTML = loadingHtml(`Getting pics in ${albumName}`);
  resetSlideElement();
  setCaption('');
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
    const slides = parsePhotosResponse(await response.text());
    if (!slides.length) {
      headerMessage.innerText = 'No photos in this album';
      resetSlideElement();
      setControlsVisible(false);
      return;
    }
    startSlideshow(slides);
  } catch (e) {
    console.error(e);
    headerMessage.innerText =
      e.message || 'Could not load photos for this album';
    setControlsVisible(false);
  }
};

const loadSharedAlbumSelector = async () => {
  const status = document.getElementById('sharedAlbumStatus');
  const select = document.getElementById('selectSharedAlbum');
  if (!select) return;
  setUsersPickerVisible(false);
  if (status) status.textContent = '';
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Pick or Stop';
  select.appendChild(placeholder);
  try {
    const url = `${SHARED_ALBUMS_URL}${SHARED_ALBUMS_URL.includes('?') ? '&' : '?'}_cb=${Date.now()}`;
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 404) {
        setUsersPickerVisible(false);
        return;
      }
      throw new Error(`Shared slideshows request failed (${response.status})`);
    }
    const raw = unwrapLambdaProxyEnvelope(JSON.parse(await response.text()));
    if (raw && typeof raw.error === 'string') throw new Error(raw.error);
    const albums = Array.isArray(raw?.albums) ? raw.albums : [];
    if (!albums.length) {
      setUsersPickerVisible(false);
      return;
    }
    setUsersPickerVisible(true);
    if (status) status.textContent = '';
    for (const album of albums) {
      if (!album?.id) continue;
      const option = document.createElement('option');
      option.value = album.id;
      const who = album.ownerLabel ? ` · ${album.ownerLabel}` : '';
      option.textContent = `${album.title || 'Slideshow'}${who}`;
      select.appendChild(option);
    }
    select.addEventListener('change', selectSharedAlbumEventHandler, true);
  } catch (e) {
    console.error(e);
    setUsersPickerVisible(true);
    if (status) {
      status.innerText = e.message || 'Could not load shared slideshows';
    }
  }
};

const selectSharedAlbumEventHandler = async (event) => {
  const headerMessage = document.getElementById('headerMessage');
  stopSlideshow();
  const id = event.target.value;
  resetFamilySelect();
  if (!id) {
    headerMessage.innerText = '';
    resetSlideElement();
    setCaption('');
    setControlsVisible(false);
    return;
  }
  headerMessage.innerHTML = loadingHtml('Getting shared pics');
  resetSlideElement();
  setCaption('');
  try {
    const [owner, ...slugParts] = id.split('/');
    const slug = slugParts.join('/');
    const url = `${SHARED_ALBUMS_URL}/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`;
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Shared photos request failed (${response.status})`);
    }
    const slides = parsePhotosResponse(await response.text());
    if (!slides.length) {
      headerMessage.innerText = 'No photos in this slideshow';
      resetSlideElement();
      setControlsVisible(false);
      return;
    }
    startSlideshow(slides);
  } catch (e) {
    console.error(e);
    headerMessage.innerText =
      e.message || 'Could not load this shared slideshow';
    setControlsVisible(false);
  }
};

function resetFamilySelect() {
  const select = document.getElementById('selectAlbum');
  if (select && select.value) select.value = '';
}

function resetSharedSelect() {
  const select = document.getElementById('selectSharedAlbum');
  if (select && select.value) select.value = '';
}

function setUsersPickerVisible(visible) {
  const col = document.getElementById('slideshow-picker-users');
  if (col) col.hidden = !visible;
}

function setCaption(text) {
  const el = document.getElementById('slideCaption');
  if (el) el.textContent = text || '';
}

const startSlideshow = (slides) => {
  allPhotos = slides;
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
  const el = document.getElementById('slide');
  const slide = allPhotos[index];
  const url = typeof slide === 'string' ? slide : slide?.url;
  if (!el || !url) return;
  const caption = typeof slide === 'string' ? '' : (slide.caption || '');
  setCaption(caption);

  const ticket = String(++slideLoadTicket);
  el.dataset.slideTicket = ticket;

  el.onerror = () => {
    if (el.dataset.slideTicket !== ticket) return;
    el.hidden = true;
    el.removeAttribute('src');
    const hm = document.getElementById('headerMessage');
    if (hm) {
      hm.innerText =
        'Photo failed to load. Common causes: S3 bucket blocks public reads, or the image URL is wrong — check DevTools → Network on the failed image request.';
    }
  };

  el.onload = () => {
    if (el.dataset.slideTicket !== ticket) return;
    el.hidden = false;
    slideHasShownOnce = true;
  };

  if (!slideHasShownOnce) el.hidden = true;
  el.alt = caption || (typeof slide === 'object' ? slide.filename : '') || '';
  el.src = url;
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
    await loadSharedAlbumSelector();
  } catch (e) {
    console.error(e);
    const el = document.getElementById('headerMessage');
    if (el) el.innerText = e.message || String(e);
  }
  setControlsVisible(false);
  resetSlideElement();

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
