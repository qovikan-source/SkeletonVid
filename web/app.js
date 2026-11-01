/**
 * app.js - SkeletonVid Pro
 * Handles checkout redirects, license sync handshake, and OS-specific installer detection.
 */

document.addEventListener("DOMContentLoaded", () => {
  detectUserOS();
  initCheckoutForm();
  initWelcomeSync();
});

function detectUserOS() {
  const ua = navigator.userAgent.toLowerCase();
  let os = "windows";
  if (ua.includes("mac")) os = "darwin";
  else if (ua.includes("linux")) os = "linux";

  const winBtns = [document.getElementById("downloadWinBtn"), document.getElementById("welcomeWinBtn")];
  const macBtns = [document.getElementById("downloadMacBtn"), document.getElementById("welcomeMacBtn")];
  const linuxBtns = [document.getElementById("downloadLinuxBtn"), document.getElementById("welcomeLinuxBtn")];

  if (os === "darwin") {
    macBtns.forEach((b) => b?.classList.replace("btn-outline", "btn-primary"));
    winBtns.forEach((b) => b?.classList.replace("btn-primary", "btn-outline"));
  } else if (os === "linux") {
    linuxBtns.forEach((b) => b?.classList.replace("btn-outline", "btn-primary"));
    winBtns.forEach((b) => b?.classList.replace("btn-primary", "btn-outline"));
  }
}

function initCheckoutForm() {
  const form = document.getElementById("checkoutForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("emailInput").value.trim();
    const btn = document.getElementById("checkoutBtn");

    btn.disabled = true;
    btn.textContent = "Redirecting to Stripe...";

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      if (!res.ok) {
        throw new Error(`Checkout error: ${res.statusText}`);
      }

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        // Fallback for local demo preview
        window.location.href = `welcome.html?session_id=local_trial_${Date.now()}`;
      }
    } catch (err) {
      console.warn("[SkeletonVid:Web] Backend offline, redirecting to local welcome demo:", err);
      window.location.href = `welcome.html?session_id=local_trial_${Date.now()}`;
    }
  });
}

function initWelcomeSync() {
  const extensionStatus = document.getElementById("extensionStatus");
  const syncStatus = document.getElementById("syncStatus");
  if (!extensionStatus) return;

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id") || `trial_${Date.now()}`;

  async function syncLicense() {
    let licenseToken = "";
    try {
      const res = await fetch("/api/license/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: sessionId })
      });
      if (res.ok) {
        const data = await res.json();
        licenseToken = data.licenseToken;
      }
    } catch (_) {
      // Local trial token fallback for direct verification
      licenseToken = `local_trial_token.${sessionId}`;
    }

    // Handshake with extension content.js via window.postMessage
    window.postMessage(
      {
        type: "SKELETONVID_LICENSE_SYNC",
        token: licenseToken || `trial_token_${sessionId}`,
        customerId: sessionId,
        status: "trialing"
      },
      "*"
    );
  }

  window.addEventListener("message", (event) => {
    if (event.data?.type === "SKELETONVID_EXTENSION_SYNCED") {
      extensionStatus.textContent = "✓ Extension Activated";
      extensionStatus.style.background = "rgba(16, 185, 129, 0.2)";
      extensionStatus.style.color = "#10b981";
      if (syncStatus) syncStatus.textContent = "LICENSE SYNCED WITH EXTENSION";
    }
  });

  // Retry handshake up to 5 times in case extension is initializing
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    syncLicense();
    if (attempts >= 5) clearInterval(interval);
  }, 1000);
}
