import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  authFetch,
  ensureSignedIn,
  isAuthError,
  isPdfSearchEnabled,
  isVideoConvertEnabled,
  getVideoConvertApiUrl,
  resetAuthForTests,
  signIn,
  syncAncestryNav,
} from "../frontend/auth.js";

const CONFIG = {
  version: "1",
  aws_region: "us-east-1",
  auth: {
    user_pool_id: "us-east-1_test",
    user_pool_client_id: "test-client",
  },
  dropbox: { api_url: "https://api.example.com/" },
  calendar: { api_url: "" },
  slideshow: { api_url: "https://api.example.com/" },
  pdfSearch: { api_url: "" },
  videoConvert: { api_url: "" },
};

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/x-amz-json-1.1" },
  });
}

function seedSession({
  id = "old-id",
  refresh = "refresh-1",
  expiresAt = Date.now() + 10 * 60 * 1000,
} = {}) {
  localStorage.setItem("id_token", id);
  localStorage.setItem("access_token", "old-access");
  localStorage.setItem("refresh_token", refresh);
  localStorage.setItem("token_expiry", String(expiresAt));
}

function cognitoResult({ id = "new-id", access = "new-access", refresh, expiresIn = 3600 } = {}) {
  const AuthenticationResult = {
    IdToken: id,
    AccessToken: access,
    ExpiresIn: expiresIn,
  };
  if (refresh) AuthenticationResult.RefreshToken = refresh;
  return jsonResponse({ AuthenticationResult });
}

function installGlobals() {
  globalThis.localStorage = memoryStorage();
  globalThis.sessionStorage = memoryStorage();
  globalThis.window = globalThis;
  const cookies = new Map();
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
    get cookie() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(raw) {
      const [pair, ...attrs] = String(raw).split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const maxAge = attrs.map((a) => a.trim()).find((a) => /^max-age=/i.test(a));
      if (maxAge && Number(maxAge.split("=")[1]) === 0) cookies.delete(name);
      else cookies.set(name, value);
    },
  };
  globalThis.window.__dlivAuthResumeWatch = true;
}

installGlobals();

let fetchImpl = async () => jsonResponse({});

beforeEach(() => {
  installGlobals();
  resetAuthForTests();
  fetchImpl = async (url) => {
    if (String(url).includes("dliv_outputs.json")) return jsonResponse(CONFIG);
    throw new Error(`Unexpected fetch: ${url}`);
  };
  globalThis.fetch = (url, options) => fetchImpl(url, options);
});

afterEach(() => {
  resetAuthForTests();
});

test("expired ID token plus a good refresh token stays signed in", async () => {
  seedSession({ expiresAt: Date.now() - 1000 });
  let refreshCalls = 0;
  fetchImpl = async (url, options) => {
    if (String(url).includes("dliv_outputs.json")) return jsonResponse(CONFIG);
    if (String(url).includes("cognito-idp")) {
      const body = JSON.parse(options.body);
      assert.equal(body.AuthFlow, "REFRESH_TOKEN_AUTH");
      assert.equal(body.AuthParameters.REFRESH_TOKEN, "refresh-1");
      refreshCalls += 1;
      return cognitoResult({ id: "fresh-id" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  assert.equal(await ensureSignedIn(), true);
  assert.equal(refreshCalls, 1);
  assert.equal(localStorage.getItem("id_token"), "fresh-id");
  assert.equal(localStorage.getItem("refresh_token"), "refresh-1");
});

test("network error on refresh does not wipe the refresh token", async () => {
  seedSession({ expiresAt: Date.now() - 1000 });
  fetchImpl = async (url) => {
    if (String(url).includes("dliv_outputs.json")) return jsonResponse(CONFIG);
    if (String(url).includes("cognito-idp")) {
      throw new TypeError("Failed to fetch");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  assert.equal(await ensureSignedIn(), true);
  assert.equal(localStorage.getItem("refresh_token"), "refresh-1");
  assert.equal(localStorage.getItem("id_token"), "old-id");
});

test("Cognito NotAuthorizedException on refresh requires sign-in", async () => {
  seedSession({ expiresAt: Date.now() - 1000 });
  fetchImpl = async (url, options) => {
    if (String(url).includes("dliv_outputs.json")) return jsonResponse(CONFIG);
    if (String(url).includes("cognito-idp")) {
      const body = JSON.parse(options.body);
      assert.equal(body.AuthFlow, "REFRESH_TOKEN_AUTH");
      return jsonResponse(
        { __type: "NotAuthorizedException", message: "Invalid Refresh Token" },
        400
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  assert.equal(await ensureSignedIn(), false);
  assert.equal(localStorage.getItem("refresh_token"), null);
  assert.equal(localStorage.getItem("id_token"), null);
});

test("API 401 then a successful refresh retries once", async () => {
  seedSession({ id: "id-1", expiresAt: Date.now() + 20 * 60 * 1000 });
  let apiCalls = 0;
  const auths = [];
  fetchImpl = async (url, options) => {
    if (String(url).includes("dliv_outputs.json")) return jsonResponse(CONFIG);
    if (String(url).includes("cognito-idp")) {
      const body = JSON.parse(options.body);
      assert.equal(body.AuthFlow, "REFRESH_TOKEN_AUTH");
      return cognitoResult({ id: "id-2" });
    }
    if (String(url).includes("api.example.com/files")) {
      apiCalls += 1;
      auths.push(options.headers.Authorization);
      assert.equal(options.cache, "no-store");
      if (apiCalls === 1) return new Response("", { status: 401 });
      return jsonResponse({ files: [] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = await authFetch("https://api.example.com/files");
  assert.equal(res.status, 200);
  assert.equal(apiCalls, 2);
  assert.deepEqual(auths, ["id-1", "id-2"]);
  assert.equal(localStorage.getItem("id_token"), "id-2");
  assert.equal(localStorage.getItem("refresh_token"), "refresh-1");
});

test("sign-in stores the refresh token", async () => {
  fetchImpl = async (url, options) => {
    if (String(url).includes("dliv_outputs.json")) return jsonResponse(CONFIG);
    if (String(url).includes("cognito-idp")) {
      const body = JSON.parse(options.body);
      assert.equal(body.AuthFlow, "USER_PASSWORD_AUTH");
      return cognitoResult({ id: "id-login", refresh: "refresh-login" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  await signIn("user@example.com", "secret");
  assert.equal(localStorage.getItem("id_token"), "id-login");
  assert.equal(localStorage.getItem("refresh_token"), "refresh-login");
  assert.equal(await ensureSignedIn(), true);
});

test("isAuthError is true only for unauthorized AuthError", async () => {
  const { AuthError } = await import("../frontend/auth.js");
  assert.equal(isAuthError(new AuthError("expired", { unauthorized: true })), true);
  assert.equal(isAuthError(new AuthError("forbidden", { unauthorized: false })), false);
  assert.equal(isAuthError(new Error("nope")), false);
});

test("refresh keeps a rotated refresh token from Cognito", async () => {
  seedSession({ expiresAt: Date.now() - 1000 });
  fetchImpl = async (url, options) => {
    if (String(url).includes("dliv_outputs.json")) return jsonResponse(CONFIG);
    if (String(url).includes("cognito-idp")) {
      return cognitoResult({ id: "fresh-id", refresh: "refresh-2" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  assert.equal(await ensureSignedIn(), true);
  assert.equal(localStorage.getItem("id_token"), "fresh-id");
  assert.equal(localStorage.getItem("refresh_token"), "refresh-2");
});

function liveCookies() {
  return String(document.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

test("sign-in stores the refresh token in localStorage only, not a cookie", async () => {
  fetchImpl = async (url, options) => {
    if (String(url).includes("dliv_outputs.json")) return jsonResponse(CONFIG);
    if (String(url).includes("cognito-idp")) {
      return cognitoResult({ id: "id-login", refresh: "refresh-login" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  await signIn("user@example.com", "secret");
  assert.equal(localStorage.getItem("refresh_token"), "refresh-login");
  assert.equal(document.cookie.includes("refresh-login"), false);
  assert.equal(liveCookies().some((row) => row.startsWith("dliv_rt=")), false);
});

test("a leftover dliv_rt cookie is cleared and is not used to stay signed in", async () => {
  document.cookie = `dliv_rt=${encodeURIComponent("cookie-refresh")}; Max-Age=1000`;
  document.cookie = "dliv_in=1; Max-Age=1000";
  let cognitoCalls = 0;
  fetchImpl = async (url) => {
    if (String(url).includes("dliv_outputs.json")) return jsonResponse(CONFIG);
    if (String(url).includes("cognito-idp")) {
      cognitoCalls += 1;
      throw new Error("Cookie must not be used as a refresh token");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  assert.equal(await ensureSignedIn(), false);
  assert.equal(cognitoCalls, 0);
  assert.equal(localStorage.getItem("refresh_token"), null);
  assert.equal(document.cookie.includes("cookie-refresh"), false);
  assert.equal(liveCookies().some((row) => row.startsWith("dliv_rt=")), false);
});

test("Ancestry stays disabled when PDF_SEARCH_API_URL is blank", async () => {
  assert.equal(await isPdfSearchEnabled(), false);
  const nav = { hidden: false };
  document.querySelectorAll = () => [nav];
  assert.equal(await syncAncestryNav(), false);
  assert.equal(nav.hidden, true);
  assert.equal(window.__ancestryEnabled, false);
});

test("Ancestry nav shows when PDF search API URL is set", async () => {
  fetchImpl = async (url) => {
    if (String(url).includes("dliv_outputs.json")) {
      return jsonResponse({
        ...CONFIG,
        pdfSearch: { api_url: "https://pdfsearch.example.com/" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const nav = { hidden: true };
  document.querySelectorAll = () => [nav];
  assert.equal(await isPdfSearchEnabled(), true);
  assert.equal(await syncAncestryNav(), true);
  assert.equal(nav.hidden, false);
  assert.equal(window.__ancestryEnabled, true);
});

test("Video convert stays disabled when VIDEO_CONVERT_API_URL is blank", async () => {
  assert.equal(await isVideoConvertEnabled(), false);
  assert.equal(await getVideoConvertApiUrl(), "");
});

test("Video convert URL is enabled and given a trailing slash", async () => {
  fetchImpl = async (url) => {
    if (String(url).includes("dliv_outputs.json")) {
      return jsonResponse({
        ...CONFIG,
        videoConvert: { api_url: "https://videoconvert.example.com/prod" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  assert.equal(await isVideoConvertEnabled(), true);
  assert.equal(await getVideoConvertApiUrl(), "https://videoconvert.example.com/prod/");
});

