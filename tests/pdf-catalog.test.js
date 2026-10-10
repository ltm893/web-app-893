import { test } from "node:test";
import assert from "node:assert/strict";

const liveFetch = globalThis.fetch.bind(globalThis);

const SITE = (process.env.DLIV_TEST_SITE || "https://dev.dliv.com").replace(/\/$/, "");
const EMAIL = (process.env.DLIV_TEST_EMAIL || "").trim();
const PASSWORD = process.env.DLIV_TEST_PASSWORD || "";
const haveCreds = Boolean(EMAIL && PASSWORD);

function isSafeDocsKey(raw) {
  const key = String(raw ?? "").trim();
  if (!key || key.length > 512) return false;
  if (key.startsWith("/") || key.includes("..") || key.includes("\\") || key.includes("//")) return false;
  if (key.startsWith("ocr/") || key.startsWith("textract-output/") || key.includes("/.")) return false;
  const parts = key.split("/");
  return parts.length >= 2 && parts.every((p) => p && /^[A-Za-z0-9._,'() &+-]+$/.test(p));
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, worker));
  return out;
}

async function signIn(cfg) {
  const res = await liveFetch(`https://cognito-idp.${cfg.aws_region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: cfg.auth.user_pool_client_id,
      AuthParameters: { USERNAME: EMAIL, PASSWORD },
    }),
  });
  const data = await res.json().catch(() => ({}));
  const token = data.AuthenticationResult?.IdToken;
  if (!token) {
    throw new Error(data.message || data.__type || `Cognito sign-in failed (${res.status})`);
  }
  return token;
}

test("every Ancestry catalog PDF has a valid key and a fetchable file", {
  timeout: 180_000,
  skip: haveCreds ? false : "Set DLIV_TEST_EMAIL and DLIV_TEST_PASSWORD to check dest.dliv.com PDFs",
}, async () => {
  const cfgRes = await liveFetch(`${SITE}/dliv_outputs.json`);
  assert.equal(cfgRes.ok, true, `Could not load ${SITE}/dliv_outputs.json`);
  const cfg = await cfgRes.json();
  const apiUrl = String(cfg.pdfSearch?.api_url || cfg.ancestry?.api_url || "").replace(/\/?$/, "/");
  assert.match(apiUrl, /^https?:\/\//i, "PDF_SEARCH_API_URL is missing on dest.dliv.com");

  const token = await signIn(cfg);
  const headers = { Authorization: token };

  const listRes = await liveFetch(`${apiUrl}search`, { headers });
  const list = await listRes.json().catch(() => ({}));
  assert.equal(listRes.ok, true, list.error || `GET /search HTTP ${listRes.status}`);
  const docs = (list.documents || []).filter((d) => d.key);
  assert.ok(docs.length > 0, "Catalog is empty");

  const failures = [];
  await mapPool(docs, 8, async (doc) => {
    const key = String(doc.key || "");
    if (!isSafeDocsKey(key)) {
      failures.push(`${key || "(empty)"}: invalid key`);
      return;
    }
    const docRes = await liveFetch(`${apiUrl}documents?key=${encodeURIComponent(key)}`, { headers });
    const data = await docRes.json().catch(() => ({}));
    if (!docRes.ok || !data.url) {
      failures.push(`${key}: ${data.error || `documents HTTP ${docRes.status}`}`);
      return;
    }
    const fileRes = await liveFetch(data.url, {
      headers: { Range: "bytes=0-4" },
    });
    if (!fileRes.ok && fileRes.status !== 206) {
      failures.push(`${key}: file HTTP ${fileRes.status}`);
      return;
    }
    const buf = Buffer.from(await fileRes.arrayBuffer());
    if (!buf.slice(0, 4).equals(Buffer.from("%PDF"))) {
      failures.push(`${key}: not a PDF`);
    }
  });

  assert.equal(
    failures.length,
    0,
    `${failures.length} of ${docs.length} PDFs failed:\n${failures.slice(0, 40).join("\n")}`,
  );
});
