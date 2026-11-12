// Forgot-password panel for each Cognito sign-in form.
import { confirmPasswordReset, requestPasswordReset } from "./auth.js";

function setStatus(status, message, ok = false) {
  status.textContent = message || "";
  status.classList.toggle("auth-reset-ok", Boolean(ok && message));
}

export function mountPasswordReset(block) {
  if (!block || block.dataset.passwordResetMounted === "1") return;
  const emailInput = block.querySelector('input[type="email"]');
  if (!emailInput) return;
  block.dataset.passwordResetMounted = "1";

  const link = document.createElement("button");
  link.type = "button";
  link.className = "auth-reset-link";
  link.textContent = "Forgot password?";

  const panel = document.createElement("div");
  panel.className = "auth-reset-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <p class="auth-reset-note">We'll email a code to the address above. The new password needs 8 or more characters, with upper, lower, a number, and a symbol.</p>
    <button type="button" class="auth-signin-submit" data-reset-send>Email a code</button>
    <div data-reset-confirm hidden>
      <input type="text" data-reset-code inputmode="numeric" autocomplete="one-time-code" placeholder="Code from email" />
      <div class="auth-password-row">
        <input type="password" data-reset-next autocomplete="new-password" placeholder="New password" />
        <span class="auth-show-pwd" data-reset-show>Show</span>
      </div>
      <div class="auth-password-row">
        <input type="password" data-reset-again autocomplete="new-password" placeholder="Repeat new password" />
        <span class="auth-show-pwd" data-reset-show>Show</span>
      </div>
      <button type="button" class="auth-signin-submit" data-reset-save>Set new password</button>
    </div>
    <p class="auth-reset-status" data-reset-status role="status"></p>
  `;

  const anchor = block.querySelector(".auth-sign-error");
  if (anchor) {
    anchor.insertAdjacentElement("afterend", panel);
    anchor.insertAdjacentElement("afterend", link);
  } else {
    block.append(link, panel);
  }

  const status = panel.querySelector("[data-reset-status]");
  const sendBtn = panel.querySelector("[data-reset-send]");
  const saveBtn = panel.querySelector("[data-reset-save]");
  const codeInput = panel.querySelector("[data-reset-code]");
  const nextInput = panel.querySelector("[data-reset-next]");
  const againInput = panel.querySelector("[data-reset-again]");
  const confirmBlock = panel.querySelector("[data-reset-confirm]");

  link.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) emailInput.focus();
  });

  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (confirmBlock.hidden) sendBtn.click();
    else saveBtn.click();
  });

  panel.querySelectorAll("[data-reset-show]").forEach((el) => {
    el.addEventListener("click", () => {
      const input = el.parentElement.querySelector("input");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      el.textContent = show ? "Hide" : "Show";
    });
  });

  sendBtn.addEventListener("click", async () => {
    setStatus(status, "");
    sendBtn.disabled = true;
    try {
      await requestPasswordReset(emailInput.value);
      confirmBlock.hidden = false;
      setStatus(status, "If that email has an account, we sent a code. Enter it with a new password.", true);
      codeInput.focus();
    } catch (err) {
      setStatus(status, err.message || "Could not send a code.");
      if (!String(emailInput.value || "").trim()) emailInput.focus();
    } finally {
      sendBtn.disabled = false;
    }
  });

  saveBtn.addEventListener("click", async () => {
    setStatus(status, "");
    if (nextInput.value !== againInput.value) {
      setStatus(status, "Those passwords don't match.");
      return;
    }
    saveBtn.disabled = true;
    try {
      await confirmPasswordReset(emailInput.value, codeInput.value, nextInput.value);
      const signInError = block.querySelector(".auth-sign-error");
      if (signInError) signInError.textContent = "";
      confirmBlock.hidden = true;
      sendBtn.hidden = true;
      codeInput.value = "";
      nextInput.value = "";
      againInput.value = "";
      panel.hidden = false;
      setStatus(status, "Password updated. Sign in with the new password.", true);
    } catch (err) {
      setStatus(status, err.message || "Could not reset the password.");
    } finally {
      saveBtn.disabled = false;
    }
  });
}

export function mountPasswordResets(root = document) {
  root.querySelectorAll(".auth-sign-block, #extract-signin").forEach((block) => {
    mountPasswordReset(block);
  });
}
