// albumSlideShow.js — reads API URL from dliv_outputs.json, no Amplify

let ALBUMS_URL = '';
let PHOTOS_URL = '';

async function loadConfig() {
  const outputs = await fetch('/dliv_outputs.json').then(r => r.json());
  const base = outputs.slideshow.api_url;
  ALBUMS_URL = base + 'albums';
  PHOTOS_URL = base + 'albums/';
}

// Slideshow state
let allPhotos = [];
let currentIndex = 0;
let isPlaying = false;
let intervalId = null;
const SLIDE_INTERVAL_MS = 3000;

const photoAlbums = async () => {
  const response = await fetch(ALBUMS_URL);
  return response.json();
}

const loadAlbumSelector = async (selector) => {
  headerMessage.innerText = 'Getting Albums';
  const albums = await photoAlbums();
  if (albums.length) {
    headerMessage.innerText = "";
    albums.unshift('Pick or Stop');
    const selectAlbum = document.getElementById(selector);
    for (const a of albums) {
      let option = document.createElement('option');
      option.value = a;
      option.text = a;
      selectAlbum.appendChild(option);
    }
    selectAlbum.addEventListener('change', selectAlbumEventHandler, true);
  } else {
    headerMessage.innerText = 'No albums returned';
  }
}

const selectAlbumEventHandler = async (event) => {
  headerMessage = document.getElementById('headerMessage');
  stopSlideshow();
  albumName = event.target.value;
  if (albumName == 'Pick or Stop') {
    headerMessage.innerText = '';
    document.getElementById('slide').src = '';
    setControlsVisible(false);
    return;
  }
  headerMessage.innerText = 'Getting Pics in ' + albumName;
  const response = await fetch(PHOTOS_URL + albumName);
  const photos = await response.json();
  startSlideshow(photos);
}

const startSlideshow = (photos) => {
  allPhotos = photos;
  currentIndex = 0;
  isPlaying = true;
  showPhoto(currentIndex);
  headerMessage = document.getElementById('headerMessage');
  headerMessage.innerText = '';
  setControlsVisible(true);
  updatePlayPauseButton();
  scheduleNextSlide();
}

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
}

const showPhoto = (index) => {
  document.getElementById('slide').src = allPhotos[index];
}

const stopSlideshow = () => {
  clearInterval(intervalId);
  isPlaying = false;
  updatePlayPauseButton();
}

const setControlsVisible = (visible) => {
  document.getElementById('controls').style.display = visible ? 'flex' : 'none';
}

const updatePlayPauseButton = () => {
  const btn = document.getElementById('playPauseBtn');
  btn.textContent = isPlaying ? '⏸' : '▶';
  btn.title = isPlaying ? 'Pause' : 'Play';
}

document.addEventListener('DOMContentLoaded', async function () {
  await loadConfig();
  loadAlbumSelector('selectAlbum');
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
    if (currentIndex > 0) { currentIndex--; showPhoto(currentIndex); }
    if (isPlaying) scheduleNextSlide();
  });

  document.getElementById('nextBtn').addEventListener('click', () => {
    if (allPhotos.length === 0) return;
    clearInterval(intervalId);
    if (currentIndex < allPhotos.length - 1) { currentIndex++; showPhoto(currentIndex); }
    if (isPlaying) scheduleNextSlide();
  });
});
