// calendar.js — shared family calendar
import { isSignedIn, signIn, signOut, authHeaders, getCalendarApiUrl } from "./auth.js";

let currentYear, currentMonth;
let _cachedEvents = [];

// ── Init ──────────────────────────────────────────────────────────────────────
window.initCalendar = async function () {
  if (isSignedIn()) {
    const now    = new Date();
    currentYear  = now.getFullYear();
    currentMonth = now.getMonth();
    renderCalendar();
  } else {
    // Login form shown by calendar.html boot script
  }
};

window.handleCalSignIn = async function () {
  const email    = document.getElementById("cal-email").value.trim();
  const password = document.getElementById("cal-password").value;
  const errEl    = document.getElementById("cal-error");
  errEl.textContent = "";
  try {
    await signIn(email, password);
    document.getElementById("cal-login").style.display    = "none";
    document.getElementById("cal-content").style.display  = "block";
    const now    = new Date();
    currentYear  = now.getFullYear();
    currentMonth = now.getMonth();
    renderCalendar();
  } catch (err) {
    errEl.textContent = err.message ?? "Sign in failed.";
  }
};

window.handleCalSignOut = async function () {
  await signOut();
  document.getElementById("cal-login").style.display   = "block";
  document.getElementById("cal-content").style.display = "none";
};

// ── Navigation ────────────────────────────────────────────────────────────────
window.calendarPrevMonth = function () {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderCalendar();
};

window.calendarNextMonth = function () {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderCalendar();
};

// ── Render ────────────────────────────────────────────────────────────────────
async function renderCalendar() {
  const grid  = document.getElementById("cal-grid");
  const title = document.getElementById("cal-month-title");

  title.textContent = new Date(currentYear, currentMonth, 1)
    .toLocaleString("default", { month: "long", year: "numeric" });
  grid.innerHTML = `<div class="cal-loading">Loading…</div>`;

  const from    = isoDate(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
  const to      = isoDate(currentYear, currentMonth, lastDay);

  try {
    const apiUrl  = await getCalendarApiUrl();
    const headers = await authHeaders();
    const res = await fetch(`${apiUrl}calendar?from=${from}&to=${to}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _cachedEvents = await res.json();
  } catch (err) {
    grid.innerHTML = `<div class="cal-error">Could not load events: ${err.message}</div>`;
    return;
  }

  const byDate = {};
  for (const ev of _cachedEvents) {
    const d = ev.startTime.slice(0, 10);
    (byDate[d] = byDate[d] ?? []).push(ev);
  }

  const firstDow    = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const today       = new Date();
  const todayStr    = isoDate(today.getFullYear(), today.getMonth(), today.getDate());

  let html = "";
  ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach((d) => {
    html += `<div class="cal-dow">${d}</div>`;
  });
  for (let i = 0; i < firstDow; i++) html += `<div class="cal-cell cal-cell--empty"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr   = isoDate(currentYear, currentMonth, day);
    const isToday   = dateStr === todayStr;
    const dayEvents = byDate[dateStr] ?? [];

    const evHtml = dayEvents.map((ev) => {
      const time = ev.startTime.slice(11, 16);
      return `<div class="cal-event" onclick="event.stopPropagation(); openEvent('${ev.eventId}')" title="${escHtml(ev.title)} — ${escHtml(ev.createdBy)}">
        <span class="cal-event-time">${time}</span> ${escHtml(ev.title)}
      </div>`;
    }).join("");

    html += `<div class="cal-cell${isToday ? " cal-cell--today" : ""}" onclick="openAddEvent('${dateStr}')" title="Click to add event">
      <div class="cal-day-num">${day}<span class="cal-day-add-hint">+ add</span></div>
      <div class="cal-events">${evHtml}</div>
    </div>`;
  }
  grid.innerHTML = html;
}

// ── Event modal ───────────────────────────────────────────────────────────────
window.openAddEvent = function (dateStr) { showModal({ dateStr }); };
window.openEvent    = function (eventId) {
  const ev = _cachedEvents.find((e) => e.eventId === eventId);
  if (ev) showModal({ event: ev });
};

function showModal({ dateStr, event } = {}) {
  const isEdit = !!event;
  document.getElementById("cal-modal-title").textContent     = isEdit ? "Edit event" : "Add event";
  document.getElementById("cal-form-title").value            = event?.title ?? "";
  document.getElementById("cal-form-desc").value             = event?.description ?? "";
  document.getElementById("cal-form-start").value            = event?.startTime?.slice(0, 16) ?? (dateStr ? `${dateStr}T09:00` : "");
  document.getElementById("cal-form-end").value              = event?.endTime?.slice(0, 16)   ?? (dateStr ? `${dateStr}T10:00` : "");
  document.getElementById("cal-form-id").value               = event?.eventId ?? "";
  document.getElementById("cal-modal-delete").style.display  = isEdit ? "inline-block" : "none";
  document.getElementById("cal-modal-createdby").textContent = isEdit ? `Created by ${event.createdBy}` : "";
  document.getElementById("cal-modal").style.display         = "flex";
  setTimeout(() => document.getElementById("cal-form-title").focus(), 50);
}

window.closeCalModal = function () {
  document.getElementById("cal-modal").style.display = "none";
};

window.saveCalEvent = async function () {
  const eventId = document.getElementById("cal-form-id").value;
  const body = {
    title:       document.getElementById("cal-form-title").value.trim(),
    description: document.getElementById("cal-form-desc").value.trim(),
    startTime:   document.getElementById("cal-form-start").value + ":00Z",
    endTime:     document.getElementById("cal-form-end").value   + ":00Z",
  };
  if (!body.title) { alert("Title is required."); return; }
  try {
    const apiUrl  = await getCalendarApiUrl();
    const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
    const res = eventId
      ? await fetch(`${apiUrl}calendar/${eventId}`, { method: "PUT",  headers, body: JSON.stringify(body) })
      : await fetch(`${apiUrl}calendar`,            { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    closeCalModal();
    renderCalendar();
  } catch (err) { alert("Could not save event: " + err.message); }
};

window.deleteCalEvent = async function () {
  const eventId = document.getElementById("cal-form-id").value;
  if (!eventId || !confirm("Delete this event?")) return;
  try {
    const apiUrl  = await getCalendarApiUrl();
    const headers = await authHeaders();
    const res = await fetch(`${apiUrl}calendar/${eventId}`, { method: "DELETE", headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    closeCalModal();
    renderCalendar();
  } catch (err) { alert("Could not delete event: " + err.message); }
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function isoDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function escHtml(str) {
  return (str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
