import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resetAuthForTests } from "../frontend/auth.js";
import { mountPasswordReset } from "../frontend/passwordReset.js";

const CONFIG = {
  aws_region: "us-east-1",
  auth: { user_pool_client_id: "test-client" },
};

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

function el(tag) {
  const node = {
    tag,
    hidden: false,
    className: "",
    value: "",
    readOnly: false,
    disabled: false,
    type: "",
    childNodes: [],
    parentElement: null,
    attrs: {},
    listeners: {},
    dataset: {},
    _text: "",
  };
  const names = () => node.className.split(/\s+/).filter(Boolean);
  node.classList = {
    add(name) {
      const set = new Set(names());
      set.add(name);
      node.className = [...set].join(" ");
    },
    remove(name) {
      node.className = names().filter((item) => item !== name).join(" ");
    },
    contains(name) {
      return names().includes(name);
    },
    toggle(name, force) {
      const on = force === undefined ? !names().includes(name) : Boolean(force);
      if (on) node.classList.add(name);
      else node.classList.remove(name);
      return on;
    },
  };
  node.append = (child) => {
    if (!child || typeof child !== "object") return;
    child.parentElement = node;
    node.childNodes.push(child);
  };
  node.querySelector = (sel) => walk(node, sel)[0] ?? null;
  node.querySelectorAll = (sel) => walk(node, sel);
  node.insertAdjacentElement = (where, other) => {
    const kids = node.parentElement.childNodes;
    const index = kids.indexOf(node);
    kids.splice(where === "afterend" ? index + 1 : index, 0, other);
    other.parentElement = node.parentElement;
  };
  node.addEventListener = (type, fn) => {
    (node.listeners[type] ||= []).push(fn);
  };
  node.click = () => Promise.all((node.listeners.click || []).map((fn) => fn({
    preventDefault() {},
    target: node,
  })));
  node.focus = () => {};
  Object.defineProperty(node, "textContent", {
    get() { return node._text; },
    set(value) { node._text = String(value ?? ""); },
  });
  Object.defineProperty(node, "innerHTML", {
    set(html) {
      node.childNodes = parseFragment(html);
      for (const child of node.childNodes) child.parentElement = node;
    },
  });
  return node;
}

function walk(node, sel) {
  const found = [];
  for (const child of node.childNodes || []) {
    if (matches(child, sel)) found.push(child);
    found.push(...walk(child, sel));
  }
  return found;
}

function matches(node, sel) {
  if (sel.startsWith(".")) return node.classList.contains(sel.slice(1));
  if (sel.startsWith("[") && sel.endsWith("]")) return Object.hasOwn(node.attrs, sel.slice(1, -1));
  const typed = sel.match(/^([a-z0-9-]+)\[([a-z0-9-]+)="([^"]*)"\]$/i);
  if (typed) return node.tag === typed[1] && node.attrs[typed[2]] === typed[3];
  return node.tag === sel;
}

function applyAttrs(node, raw) {
  const re = /([^\s="]+)(?:="([^"]*)")?/g;
  let match;
  while ((match = re.exec(raw))) {
    node.attrs[match[1]] = match[2] ?? "";
    if (match[1] === "class") node.className = match[2];
    if (match[1] === "type") node.type = match[2];
    if (match[1] === "hidden") node.hidden = true;
  }
}

function parseFragment(html) {
  const root = el("fragment");
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-z0-9-]+)>|<([a-z0-9-]+)([^>]*?)(\/?)>|([^<]+)/gi;
  let match;
  while ((match = re.exec(html))) {
    if (match[0].startsWith("<!--")) continue;
    if (match[1]) {
      stack.pop();
      continue;
    }
    if (match[2]) {
      const node = el(match[2].toLowerCase());
      applyAttrs(node, match[3] || "");
      stack.at(-1).append(node);
      if (match[4] !== "/" && node.tag !== "input") stack.push(node);
      continue;
    }
    const text = match[5].replace(/\s+/g, " ").trim();
    if (text) stack.at(-1).textContent += text;
  }
  return root.childNodes;
}

function signInBlock() {
  const block = el("div");
  block.className = "auth-sign-block";
  const heading = el("h3");
  heading.textContent = "Sign In";
  const email = el("input");
  email.attrs.type = "email";
  email.type = "email";
  const passwordRow = el("div");
  passwordRow.className = "auth-password-row";
  const password = el("input");
  password.attrs.type = "password";
  password.type = "password";
  passwordRow.append(password);
  const submit = el("button");
  submit.className = "auth-signin-submit";
  submit.textContent = "Sign In";
  const error = el("p");
  error.className = "auth-sign-error";
  for (const child of [heading, email, passwordRow, submit, error]) block.append(child);
  return block;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  globalThis.localStorage = memoryStorage();
  globalThis.sessionStorage = memoryStorage();
  globalThis.window = globalThis;
  globalThis.document = {
    createElement: (tag) => el(tag),
    cookie: "",
  };
  resetAuthForTests();
});

function cognitoOk() {
  globalThis.fetch = async (url) => {
    if (String(url).includes("dliv_outputs.json")) return jsonResponse(CONFIG);
    if (String(url).includes("cognito-idp")) return jsonResponse({});
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test("sending the code leaves only the reset step", async () => {
  const css = readFileSync(new URL("../frontend/slideshow.css", import.meta.url), "utf8");
  const extract = readFileSync(new URL("../frontend/extract.html", import.meta.url), "utf8");
  assert.match(css, /\.auth-sign-block\.is-resetting > :not\(h3\):not\(input\[type="email"\]\):not\(\.auth-reset-panel\)/);
  assert.match(css, /\.auth-sign-block\.is-resetting \[data-reset-send\]/);
  assert.match(extract, /#extract-signin\.is-resetting > :not\(input\[type="email"\]\):not\(\.auth-reset-panel\)/);

  cognitoOk();
  const block = signInBlock();
  mountPasswordReset(block);
  const email = block.querySelector('input[type="email"]');
  email.value = "user@example.com";
  await block.querySelector("[data-reset-send]").click();

  assert.equal(block.classList.contains("is-resetting"), true);
  assert.equal(block.querySelector("h3").textContent, "Reset password");
  assert.equal(email.readOnly, true);
  assert.equal(block.querySelector("[data-reset-confirm]").hidden, false);
  assert.equal(
    block.querySelector("[data-reset-status]").textContent,
    "If that email has an account, we sent a code. Enter it with a new password."
  );
  assert.equal(block.querySelector(".auth-password-row").parentElement, block);
});

test("a different email returns to the sign-in form", async () => {
  cognitoOk();
  const block = signInBlock();
  mountPasswordReset(block);
  block.querySelector('input[type="email"]').value = "user@example.com";
  await block.querySelector("[data-reset-send]").click();
  block.querySelector("[data-reset-code]").value = "123456";
  await block.querySelector("[data-reset-back]").click();

  assert.equal(block.classList.contains("is-resetting"), false);
  assert.equal(block.querySelector("h3").textContent, "Sign In");
  assert.equal(block.querySelector('input[type="email"]').readOnly, false);
  assert.equal(block.querySelector("[data-reset-confirm]").hidden, true);
  assert.equal(block.querySelector("[data-reset-code]").value, "");
});

test("a successful reset shows the sign-in form again", async () => {
  cognitoOk();
  const block = signInBlock();
  mountPasswordReset(block);
  block.querySelector('input[type="email"]').value = "user@example.com";
  await block.querySelector("[data-reset-send]").click();
  block.querySelector("[data-reset-code]").value = "123456";
  block.querySelector("[data-reset-next]").value = "NewPass1!";
  block.querySelector("[data-reset-again]").value = "NewPass1!";
  await block.querySelector("[data-reset-save]").click();

  assert.equal(block.classList.contains("is-resetting"), false);
  assert.equal(block.querySelector(".auth-reset-panel").classList.contains("is-reset-done"), true);
  assert.equal(block.querySelector("h3").textContent, "Sign In");
  assert.equal(block.querySelector('input[type="email"]').readOnly, false);
  assert.equal(block.querySelector("[data-reset-confirm]").hidden, true);
  assert.equal(
    block.querySelector("[data-reset-status]").textContent,
    "Password updated. Sign in with the new password."
  );
});

test("passwords that do not match stay on the reset step", async () => {
  let cognitoCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("dliv_outputs.json")) return jsonResponse(CONFIG);
    if (String(url).includes("cognito-idp")) {
      cognitoCalls += 1;
      return jsonResponse({});
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const block = signInBlock();
  mountPasswordReset(block);
  block.querySelector('input[type="email"]').value = "user@example.com";
  await block.querySelector("[data-reset-send]").click();
  cognitoCalls = 0;
  block.querySelector("[data-reset-code]").value = "123456";
  block.querySelector("[data-reset-next]").value = "NewPass1!";
  block.querySelector("[data-reset-again]").value = "OtherPass1!";
  await block.querySelector("[data-reset-save]").click();

  assert.equal(cognitoCalls, 0);
  assert.equal(block.classList.contains("is-resetting"), true);
  assert.equal(block.querySelector("[data-reset-status]").textContent, "Those passwords don't match.");
});
