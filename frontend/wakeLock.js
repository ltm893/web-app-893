// Screen Wake Lock during long S3 uploads (same idea as a playing video).
// Does not stop sleep if the laptop lid is closed.

let held = 0;
let sentinel = null;
let listening = false;

function getNavigator() {
  return typeof navigator !== "undefined" ? navigator : undefined;
}

function getDocument() {
  return typeof document !== "undefined" ? document : undefined;
}

async function dropSentinel() {
  const lock = sentinel;
  sentinel = null;
  if (!lock) return;
  try {
    await lock.release();
  } catch {
    // already released
  }
}

async function requestLock() {
  const n = getNavigator();
  const d = getDocument();
  if (held <= 0 || !n?.wakeLock?.request) return false;
  if (d && d.visibilityState && d.visibilityState !== "visible") return false;
  if (sentinel) return true;
  try {
    const lock = await n.wakeLock.request("screen");
    sentinel = lock;
    lock.addEventListener?.("release", () => {
      if (sentinel === lock) sentinel = null;
    });
    return true;
  } catch {
    return false;
  }
}

function onVisibilityChange() {
  const d = getDocument();
  if (!d || held <= 0) return;
  if (d.visibilityState === "visible") return requestLock();
  sentinel = null;
}

function bindVisibility() {
  const d = getDocument();
  if (!d || listening) return;
  d.addEventListener("visibilitychange", onVisibilityChange);
  listening = true;
}

function unbindVisibility() {
  const d = getDocument();
  if (!d || !listening) return;
  d.removeEventListener("visibilitychange", onVisibilityChange);
  listening = false;
}

export async function holdWakeLock() {
  held += 1;
  bindVisibility();
  await requestLock();
}

export async function releaseWakeLock() {
  held = Math.max(0, held - 1);
  if (held > 0) return;
  unbindVisibility();
  await dropSentinel();
}

export function wakeLockIsHeld() {
  return held > 0;
}

export async function resetWakeLockForTests() {
  held = 0;
  unbindVisibility();
  await dropSentinel();
}
