/**
 * nativeBridge.js - SkeletonVid Pro
 * Persistent Native Messaging Bridge with process cancellation support.
 */

const NATIVE_HOST_NAME = "com.SkeletonVid.host";

class NativeBridge {
  constructor() {
    this.port = null;
    this.activeJobs = new Map();
    this.isConnected = false;
  }

  ensureConnected() {
    if (this.port) return this.port;

    try {
      this.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      this.isConnected = true;

      this.port.onMessage.addListener((msg) => {
        this.handleIncomingMessage(msg);
      });

      this.port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError?.message || "Companion disconnected";
        console.warn("[SkeletonVid:NativeBridge] Native port disconnected:", err);
        this.port = null;
        this.isConnected = false;
        chrome.runtime.sendMessage({
          type: "NATIVE_DISCONNECTED",
          error: err
        }).catch(() => {});
      });

      return this.port;
    } catch (err) {
      console.error("[SkeletonVid:NativeBridge] Failed to connect native port:", err);
      this.port = null;
      this.isConnected = false;
      return null;
    }
  }

  handleIncomingMessage(msg) {
    if (!msg || !msg.jobId) return;

    if (msg.type === "PROGRESS" || msg.type === "COMPLETED" || msg.type === "ERROR") {
      this.activeJobs.set(msg.jobId, {
        ...(this.activeJobs.get(msg.jobId) || {}),
        ...msg,
        updatedAt: Date.now()
      });

      // Broadcast progress update to popup
      chrome.runtime.sendMessage({
        type: "JOB_UPDATE",
        payload: msg
      }).catch(() => {});

      // Persist state in session storage
      this.syncJobsToStorage();
    }
  }

  startDownload(jobPayload) {
    const port = this.ensureConnected();
    if (!port) {
      throw new Error("Unable to establish native connection to SkeletonVid Companion");
    }

    this.activeJobs.set(jobPayload.jobId, {
      jobId: jobPayload.jobId,
      title: jobPayload.title,
      status: "starting",
      percent: 0,
      speed: "0 KB/s",
      eta: "—",
      createdAt: Date.now()
    });

    port.postMessage(jobPayload);
    this.syncJobsToStorage();
    return jobPayload.jobId;
  }

  cancelDownload(jobId) {
    const port = this.ensureConnected();
    if (port) {
      port.postMessage({
        type: "CANCEL_DOWNLOAD",
        jobId
      });
    }

    const job = this.activeJobs.get(jobId);
    if (job) {
      job.status = "canceled";
      job.speed = "Canceled";
      this.syncJobsToStorage();
      chrome.runtime.sendMessage({
        type: "JOB_UPDATE",
        payload: job
      }).catch(() => {});
    }
  }

  getActiveJobs() {
    return Array.from(this.activeJobs.values());
  }

  async syncJobsToStorage() {
    try {
      if (chrome.storage.session) {
        await chrome.storage.session.set({
          activeJobs: Array.from(this.activeJobs.entries())
        });
      }
    } catch (err) {
      console.warn("[SkeletonVid:NativeBridge] Session storage sync failed:", err);
    }
  }

  async restoreJobsFromStorage() {
    try {
      if (chrome.storage.session) {
        const data = await chrome.storage.session.get("activeJobs");
        if (Array.isArray(data.activeJobs)) {
          for (const [id, job] of data.activeJobs) {
            this.activeJobs.set(id, job);
          }
        }
      }
    } catch (err) {
      console.warn("[SkeletonVid:NativeBridge] Session storage restore failed:", err);
    }
  }
}

export const nativeBridge = new NativeBridge();
