import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  holdWakeLock,
  releaseWakeLock,
  resetWakeLockForTests,
  wakeLockIsHeld,
} from "../frontend/wakeLock.js";

afterEach(async () => {
  await resetWakeLockForTests();
  delete globalThis.navigator;
  delete globalThis.document;
});

test("holdWakeLock is a no-op when Wake Lock is missing", async () => {
  globalThis.navigator = {};
  await holdWakeLock();
  assert.equal(wakeLockIsHeld(), true);
  await releaseWakeLock();
  assert.equal(wakeLockIsHeld(), false);
});

test("requests a screen lock and releases it", async () => {
  const released = [];
  const lock = {
    addEventListener() {},
    async release() { released.push(true); },
  };
  let requests = 0;
  globalThis.navigator = {
    wakeLock: {
      async request(type) {
        requests += 1;
        assert.equal(type, "screen");
        return lock;
      },
    },
  };
  globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  await holdWakeLock();
  assert.equal(requests, 1);
  await releaseWakeLock();
  assert.equal(released.length, 1);
  assert.equal(wakeLockIsHeld(), false);
});

test("re-requests the lock when the tab becomes visible again", async () => {
  let requests = 0;
  let visibilityHandler;
  const lock = { addEventListener() {}, async release() {} };
  globalThis.navigator = {
    wakeLock: {
      async request() {
        requests += 1;
        return lock;
      },
    },
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener(type, fn) {
      if (type === "visibilitychange") visibilityHandler = fn;
    },
    removeEventListener() {},
  };
  await holdWakeLock();
  assert.equal(requests, 1);
  globalThis.document.visibilityState = "hidden";
  visibilityHandler();
  globalThis.document.visibilityState = "visible";
  await visibilityHandler();
  assert.equal(requests, 2);
  await releaseWakeLock();
});
