/**
 * popup.js - SkeletonVid Pro
 * Controls popup UI, stream inspection, job telemetry, and license state.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const pageTitleEl = document.getElementById("pageTitle");
  const streamListEl = document.getElementById("streamList");
  const jobListEl = document.getElementById("jobList");
  const streamCountEl = document.getElementById("streamCount");
  const activeCountEl = document.getElementById("activeCount");
  const qualitySelect = document.getElementById("qualitySelect");
  const downloadPageBtn = document.getElementById("downloadPageBtn");
  const drmWarning = document.getElementById("drmWarning");
  const drmBadge = document.getElementById("drmBadge");
  const directControls = document.getElementById("directControls");
  const licenseBadge = document.getElementById("licenseBadge");
  const licenseBanner = document.getElementById("licenseBanner");
  const activateTrialBtn = document.getElementById("activateTrialBtn");
  const manageBillingBtn = document.getElementById("manageBillingBtn");
  const troubleshootBtn = document.getElementById("troubleshootBtn");

  const cleanTitle = (tab.title || "Lecture_Video").replace(/[\\/:*?"<>|]/g, "-").trim();
  pageTitleEl.textContent = cleanTitle;

  function refreshState() {
    chrome.runtime.sendMessage({ type: "GET_TAB_STATE", tabId: tab.id }, (state) => {
      if (!state) return;
      applyLicenseState(state.license);
      applyDrmState(state.meta);
      renderStreams(state.streams || []);
      renderJobs(state.jobs || []);
    });
  }

  function applyLicenseState(license) {
    if (!license || !license.hasLicense) {
      licenseBadge.textContent = "No License";
      licenseBadge.className = "badge badge-warn";
      licenseBanner.style.display = "flex";
      return;
    }
    licenseBanner.style.display = "none";
    if (license.status === "trialing") {
      licenseBadge.textContent = "3-Day Trial";
      licenseBadge.className = "badge";
    } else if (license.status === "active") {
      licenseBadge.textContent = "Pro Active";
      licenseBadge.className = "badge";
    } else {
      licenseBadge.textContent = license.status.toUpperCase();
      licenseBadge.className = "badge badge-warn";
      licenseBanner.style.display = "flex";
    }
  }

  function applyDrmState(meta) {
    if (meta?.isDrm) {
      drmWarning.style.display = "block";
      drmBadge.style.display = "inline-block";
      directControls.style.display = "none";
    } else {
      drmWarning.style.display = "none";
      drmBadge.style.display = "none";
      directControls.style.display = "flex";
    }
  }

  function renderStreams(streams) {
    streamCountEl.textContent = String(streams.length);
    if (streams.length === 0) {
      streamListEl.innerHTML = `<div class="empty-state">Play the lecture video to detect streams.</div>`;
      return;
    }

    streamListEl.innerHTML = "";
    streams.slice(0, 5).forEach((s) => {
      const isMaster = s.role === "MASTER";
      const isStale = s.freshness?.isStale;
      const ageText = `${s.freshness?.ageSec || 0}s ago`;

      const item = document.createElement("div");
      item.className = "stream-item";
      item.innerHTML = `
        <div class="stream-info">
          <div class="stream-tags">
            <span class="badge ${isMaster ? "" : "badge-warn"}">${s.role} (${s.kind.toUpperCase()})</span>
            <span class="stream-meta">${isStale ? "Token Stale" : ageText}</span>
          </div>
        </div>
        <button class="btn ${isStale ? "btn-outline-sm" : "btn-primary"}">
          ${isStale ? "Reload Tab" : "Download"}
        </button>
      `;

      item.querySelector("button").addEventListener("click", () => {
        if (isStale) {
          chrome.tabs.reload(tab.id);
          window.close();
        } else {
          initiateDownload(s.url, tab.url, cleanTitle, qualitySelect.value);
        }
      });
      streamListEl.appendChild(item);
    });
  }

  function renderJobs(jobs) {
    const active = jobs.filter((j) => j.status !== "completed" && j.status !== "canceled");
    activeCountEl.textContent = String(active.length);

    if (jobs.length === 0) {
      jobListEl.innerHTML = `<div class="empty-state">No downloads running.</div>`;
      return;
    }

    jobListEl.innerHTML = "";
    jobs.slice(-3).forEach((j) => {
      const item = document.createElement("div");
      item.className = "job-item";
      const pct = typeof j.percent === "number" ? j.percent.toFixed(1) : "0.0";
      const isDone = j.status === "completed";
      const isFailed = j.status === "error";

      item.innerHTML = `
        <div class="job-header">
          <span class="job-title">${j.title || "Video"}</span>
          <div style="display:flex; gap:6px; align-items:center;">
            <span class="badge ${isDone ? "" : isFailed ? "badge-danger" : "badge-warn"}">${j.status.toUpperCase()}</span>
            ${!isDone && !isFailed ? `<button class="btn-danger-sm cancel-btn">Cancel</button>` : ""}
          </div>
        </div>
        <div class="progress-track">
          <div class="progress-bar" style="width: ${pct}%;"></div>
        </div>
        <div class="job-telemetry">
          <span>${pct}% • ${j.speed || "—"}</span>
          <span>ETA ${j.eta || "—"}</span>
        </div>
      `;

      const cancelBtn = item.querySelector(".cancel-btn");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
          chrome.runtime.sendMessage({ type: "CANCEL_DOWNLOAD", jobId: j.jobId });
        });
      }

      jobListEl.appendChild(item);
    });
  }

  function initiateDownload(url, pageUrl, title, format) {
    chrome.runtime.sendMessage(
      { type: "START_DOWNLOAD", url, pageUrl, title, format },
      (res) => {
        if (!res?.ok) {
          if (res?.error === "NO_LICENSE") {
            chrome.tabs.create({ url: "https://SkeletonVid.pro/pricing" });
          } else {
            alert(`Download error: ${res?.error || "Unknown error"}`);
          }
        }
        refreshState();
      }
    );
  }

  downloadPageBtn.addEventListener("click", () => {
    initiateDownload(tab.url, tab.url, cleanTitle, qualitySelect.value);
  });

  activateTrialBtn?.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://SkeletonVid.pro/pricing" });
  });

  manageBillingBtn?.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://SkeletonVid.pro/pricing" });
  });

  troubleshootBtn?.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://SkeletonVid.pro/setup" });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "JOB_UPDATE") refreshState();
  });

  refreshState();
});
