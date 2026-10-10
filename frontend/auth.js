// auth.js — raw Cognito SRP auth, no Amplify SDK
// Reads config from dliv_outputs.json

let _config = null;
let _idToken = null;
let _accessToken = null;
let _refreshToken = null;
let _tokenExpiry = 0;

const TOKEN_KEYS = ["id_token", "access_token", "refresh_token", "token_expiry"];
const LEGACY_AUTH_COOKIES = ["dliv_rt", "dliv_in"];
const KEEPALIVE_MS = 45 * 60 * 1000;

// ── Config ────────────────────────────────────────────────────────────────────

async function getConfig() {
  if (!_config) {
    _config = await fetch("/dliv_outputs.json").then((r) => r.json());
  }
  return _config;
}

export async function getDropboxApiUrl() {
  const cfg = await getConfig();
  return cfg.dropbox.api_url;
}

export async function getPdfSearchApiUrl() {
  const cfg = await getConfig();
  return cfg.pdfSearch?.api_url || cfg.ancestry?.api_url || "";
}

export async function getVideoConvertApiUrl() {
  const cfg = await getConfig();
  const url = String(cfg.videoConvert?.api_url || "").trim();
  if (!url) return "";
  return url.endsWith("/") ? url : `${url}/`;
}

export async function isVideoConvertEnabled() {
  try {
    const url = String(await getVideoConvertApiUrl() || "").trim();
    return /^https?:\/\//i.test(url);
  } catch {
    return false;
  }
}

export async function isPdfSearchEnabled() {
  try {
    const url = String(await getPdfSearchApiUrl() || "").trim();
    return /^https?:\/\//i.test(url);
  } catch {
    return false;
  }
}

/** Hide Ancestry nav unless PDF_SEARCH_API_URL is set (dev.dliv.com only for now). */
export async function syncAncestryNav() {
  const on = await isPdfSearchEnabled();
  if (typeof window !== "undefined") window.__ancestryEnabled = on;
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return on;
  document.querySelectorAll('[data-nav="ancestry"]').forEach((el) => {
    el.hidden = !on;
  });
  return on;
}

export async function getCalendarApiUrl() {
  const cfg = await getConfig();
  return cfg.calendar.api_url;
}

export async function getSlideshowApiUrl() {
  const cfg = await getConfig();
  return cfg.slideshow.api_url;
}

export function loadingHtml(label = "Loading", { dark = false } = {}) {
  const text = String(label || "Loading")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const cls = dark ? "apple-progress apple-progress--on-dark" : "apple-progress";
  return `<div class="${cls}" role="status" aria-live="polite">
    <p class="apple-progress-label">${text}</p>
    <div class="apple-progress-track"><div class="apple-progress-bar"></div></div>
  </div>`;
}

// ── Token storage (localStorage — persists across tabs and browser restarts) ──

function migrateSessionStorage() {
  if (localStorage.getItem("id_token")) return;
  if (!TOKEN_KEYS.some((k) => sessionStorage.getItem(k))) return;
  for (const k of TOKEN_KEYS) {
    const v = sessionStorage.getItem(k);
    if (v != null) localStorage.setItem(k, v);
    sessionStorage.removeItem(k);
  }
}

function clearLegacyAuthCookies() {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  for (const name of LEGACY_AUTH_COOKIES) {
    document.cookie = `${encodeURIComponent(name)}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
  }
}

function saveTokens({ idToken, accessToken, refreshToken, expiresIn = 3600 }) {
  _idToken      = idToken;
  _accessToken  = accessToken;
  if (refreshToken) _refreshToken = refreshToken;
  _tokenExpiry  = Date.now() + (Math.max(Number(expiresIn) || 3600, 120) - 60) * 1000;
  localStorage.setItem("id_token",      idToken);
  localStorage.setItem("access_token",  accessToken);
  if (refreshToken) localStorage.setItem("refresh_token", refreshToken);
  localStorage.setItem("token_expiry",  String(_tokenExpiry));
  clearLegacyAuthCookies();
}

function loadTokensFromStorage() {
  migrateSessionStorage();
  clearLegacyAuthCookies();
  _idToken      = localStorage.getItem("id_token");
  _accessToken  = localStorage.getItem("access_token");
  _refreshToken = localStorage.getItem("refresh_token");
  _tokenExpiry  = Number(localStorage.getItem("token_expiry") ?? 0);
}

function clearTokens() {
  _idToken = _accessToken = _refreshToken = null;
  _tokenExpiry = 0;
  for (const k of TOKEN_KEYS) {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  }
  clearLegacyAuthCookies();
}

function isInvalidRefreshError(err) {
  const type = String(err?.cognitoType || "");
  const msg = String(err?.message || "");
  return /NotAuthorizedException|Invalid Refresh Token|UserNotFoundException|Not signed in/i.test(
    `${type} ${msg}`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNetwork() {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return;
  await Promise.race([
    new Promise((resolve) => {
      if (typeof window === "undefined") return resolve();
      window.addEventListener("online", resolve, { once: true });
    }),
    sleep(4000),
  ]);
  await sleep(250);
}

// ── Cognito REST calls ────────────────────────────────────────────────────────

async function cognitoRequest(target, body) {
  const cfg = await getConfig();
  const region = cfg.aws_region;
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type":  "application/x-amz-json-1.1",
      "X-Amz-Target":  `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message ?? data.__type ?? `HTTP ${res.status}`);
    err.cognitoType = data.__type || "";
    err.status = res.status;
    throw err;
  }
  return data;
}

let _refreshInFlight = null;

async function refreshSession() {
  loadTokensFromStorage();
  if (!_refreshToken) {
    const err = new Error("Not signed in");
    err.cognitoType = "NotAuthorizedException";
    throw err;
  }
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = (async () => {
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await waitForNetwork();
        const cfg = await getConfig();
        const data = await cognitoRequest("InitiateAuth", {
          AuthFlow: "REFRESH_TOKEN_AUTH",
          AuthParameters: { REFRESH_TOKEN: _refreshToken },
          ClientId: cfg.auth.user_pool_client_id,
        });
        const result = data.AuthenticationResult;
        if (!result?.IdToken) throw new Error("Unexpected response from Cognito");
        saveTokens({
          idToken: result.IdToken,
          accessToken: result.AccessToken,
          refreshToken: result.RefreshToken,
          expiresIn: result.ExpiresIn,
        });
        return _idToken;
      } catch (err) {
        lastErr = err;
        if (isInvalidRefreshError(err)) throw err;
        if (attempt < 4) await sleep(500 * (attempt + 1));
      }
    }
    throw lastErr;
  })().finally(() => {
    _refreshInFlight = null;
  });
  return _refreshInFlight;
}

function watchForResume() {
  if (typeof window === "undefined" || window.__dlivAuthResumeWatch) return;
  window.__dlivAuthResumeWatch = true;
  const resume = () => {
    loadTokensFromStorage();
    if (!_refreshToken) return;
    if (_idToken && Date.now() < _tokenExpiry - 5 * 60 * 1000) return;
    sleep(400).then(() => refreshSession()).catch(() => {});
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resume();
  });
  window.addEventListener("pageshow", resume);
  window.addEventListener("focus", resume);
  window.addEventListener("online", resume);
  if (!window.__dlivAuthKeepalive) {
    window.__dlivAuthKeepalive = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      loadTokensFromStorage();
      if (!_refreshToken) return;
      refreshSession().catch(() => {});
    }, KEEPALIVE_MS);
  }
}

// ── Public auth API ───────────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(message, { status, unauthorized = false } = {}) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.unauthorized = unauthorized;
  }
}

export function isAuthError(err) {
  return err instanceof AuthError && err.unauthorized;
}

export async function signIn(email, password) {
  const cfg = await getConfig();
  const data = await cognitoRequest("InitiateAuth", {
    AuthFlow:       "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: email, PASSWORD: password },
    ClientId:       cfg.auth.user_pool_client_id,
  });

  const result = data.AuthenticationResult;
  if (!result) throw new Error("Unexpected response from Cognito");

  saveTokens({
    idToken:      result.IdToken,
    accessToken:  result.AccessToken,
    refreshToken: result.RefreshToken,
    expiresIn:    result.ExpiresIn,
  });
  return result;
}

export async function signOut() {
  clearTokens();
}

/** Test-only: clear cached config and tokens without implying a user logout flow. */
export function resetAuthForTests() {
  _config = null;
  _refreshInFlight = null;
  if (typeof window !== "undefined") window.__dlivAuthResumeWatch = true;
  clearTokens();
}

export async function getIdToken({ force = false } = {}) {
  loadTokensFromStorage();
  watchForResume();
  if (!_idToken && !_refreshToken) throw new Error("Not signed in");

  const expiringSoon = !_idToken || Date.now() > _tokenExpiry - 5 * 60 * 1000;
  if (force || expiringSoon) {
    if (!_refreshToken) {
      clearTokens();
      throw new Error("Not signed in");
    }
    try {
      await refreshSession();
    } catch (err) {
      if (isInvalidRefreshError(err)) {
        clearTokens();
        throw err;
      }
      if (!_idToken || Date.now() > _tokenExpiry) throw err;
    }
  }
  if (!_idToken) throw new Error("Not signed in");
  return _idToken;
}

export function isSignedIn() {
  loadTokensFromStorage();
  return !!(_idToken || _refreshToken);
}

/** Load tokens and silently refresh if expired. Returns false when re-login is needed. */
export async function ensureSignedIn() {
  loadTokensFromStorage();
  watchForResume();
  if (!_idToken && !_refreshToken) return false;
  try {
    await getIdToken();
    return true;
  } catch (err) {
    if (isInvalidRefreshError(err)) {
      clearTokens();
      return false;
    }
    return !!(_refreshToken || _idToken);
  }
}

export async function authHeaders() {
  const token = await getIdToken();
  return { Authorization: token };
}

/** Authenticated fetch — clears tokens only when Cognito says the session is invalid. */
export async function authFetch(url, options = {}) {
  const headers = { ...(options.headers ?? {}), ...(await authHeaders()) };
  const fetchOpts = { cache: "no-store", ...options, headers };
  let res = await fetch(url, fetchOpts);
  if (res.status !== 401) return res;
  try {
    const token = await getIdToken({ force: true });
    res = await fetch(url, {
      ...fetchOpts,
      headers: { ...(options.headers ?? {}), Authorization: token },
    });
    if (res.status !== 401) return res;
  } catch (err) {
    if (isInvalidRefreshError(err)) {
      clearTokens();
      throw new AuthError("Session expired — please sign in again.", { status: 401, unauthorized: true });
    }
    throw err;
  }
  throw new AuthError("Not authorized.", { status: 401, unauthorized: false });
}
