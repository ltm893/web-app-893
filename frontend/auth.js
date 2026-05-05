// auth.js — raw Cognito SRP auth, no Amplify SDK
// Reads config from dliv_outputs.json

let _config = null;
let _idToken = null;
let _accessToken = null;
let _refreshToken = null;
let _tokenExpiry = 0;

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

export async function getCalendarApiUrl() {
  const cfg = await getConfig();
  return cfg.calendar.api_url;
}

export async function getSlideshowApiUrl() {
  const cfg = await getConfig();
  return cfg.slideshow.api_url;
}

// ── Token storage (sessionStorage — cleared on tab close) ─────────────────────

function saveTokens({ idToken, accessToken, refreshToken, expiresIn = 3600 }) {
  _idToken      = idToken;
  _accessToken  = accessToken;
  if (refreshToken) _refreshToken = refreshToken;
  _tokenExpiry  = Date.now() + (expiresIn - 60) * 1000;
  sessionStorage.setItem("id_token",      idToken);
  sessionStorage.setItem("access_token",  accessToken);
  if (refreshToken) sessionStorage.setItem("refresh_token", refreshToken);
  sessionStorage.setItem("token_expiry",  String(_tokenExpiry));
}

function loadTokensFromStorage() {
  _idToken      = sessionStorage.getItem("id_token");
  _accessToken  = sessionStorage.getItem("access_token");
  _refreshToken = sessionStorage.getItem("refresh_token");
  _tokenExpiry  = Number(sessionStorage.getItem("token_expiry") ?? 0);
}

function clearTokens() {
  _idToken = _accessToken = _refreshToken = null;
  _tokenExpiry = 0;
  sessionStorage.removeItem("id_token");
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("refresh_token");
  sessionStorage.removeItem("token_expiry");
}

// ── Cognito REST calls ────────────────────────────────────────────────────────

async function cognitoRequest(target, body) {
  const cfg = await getConfig();
  const region = cfg.aws_region;
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/x-amz-json-1.1",
      "X-Amz-Target":  `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message ?? data.__type ?? `HTTP ${res.status}`);
  }
  return data;
}

// ── Public auth API ───────────────────────────────────────────────────────────

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

export async function getIdToken() {
  loadTokensFromStorage();
  if (!_idToken) throw new Error("Not signed in");

  // Refresh if within 60 seconds of expiry
  if (Date.now() > _tokenExpiry && _refreshToken) {
    const cfg  = await getConfig();
    const data = await cognitoRequest("InitiateAuth", {
      AuthFlow:       "REFRESH_TOKEN_AUTH",
      AuthParameters: { REFRESH_TOKEN: _refreshToken },
      ClientId:       cfg.auth.user_pool_client_id,
    });
    const result = data.AuthenticationResult;
    saveTokens({
      idToken:     result.IdToken,
      accessToken: result.AccessToken,
      expiresIn:   result.ExpiresIn,
    });
  }
  return _idToken;
}

export function isSignedIn() {
  loadTokensFromStorage();
  return !!_idToken;
}

export async function authHeaders() {
  const token = await getIdToken();
  return { Authorization: token };
}
