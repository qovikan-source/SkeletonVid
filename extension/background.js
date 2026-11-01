/**
 * background.js - SkeletonVid Pro
 * MV3 Service Worker orchestrating web request sniffing and native bridge.
 */

import { classifyStream, isMediaRequest } from "./streamClassifier.js";
import { checkStreamFreshness } from "./tokenChecker.js";
import { getCookiesForDownload } from "./cookieHelper.js";
import { nativeBridge } from "./nativeBridge.js";

const tabStreams = new Map(); // tabId -> { meta, streams: Map<url, StreamInfo> }

// 1. Sniff Media Requests via webRequest
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;

    const contentTypeHeader = details.responseHeaders?.find(
      (h) => h.name.toLowerCase() === "content-type"
    );
    const contentType = contentTypeHeader ? contentTypeHeader.value : "";

    if (!isMediaRequest(details.url, contentType)) return;

    const classification = classifyStream(details.url, contentType);

    if (!tabStreams.has(details.tabId)) {
      tabStreams.set(details.tabId, {
        meta: { title: "Course Lecture", url: "", isDrm: false, hasVideoTag: false },
        streams: new Map()
      });
    }

    const tabData = tabStreams.get(details.tabId);
    tabData.streams.set(details.url, {
      url: details.url,
      ...classification,
      capturedAt: Date.now()
    });

    updateBadge(details.tabId);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

function updateBadge(tabId) {
  const data = tabStreams.get(tabId);
  if (!data) return;
  const count = data.streams.size;
  chrome.action.setBadgeText({
    tabId,
    text: count > 0 ? String(count) : ""
  });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#10B981" });
}

// Clean up closed tabs
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStreams.delete(tabId);
});

// Restore persisted session state on startup
nativeBridge.restoreJobsFromStorage();

// 2. Message Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PAGE_METADATA" && sender.tab?.id) {
    const tabId = sender.tab.id;
    if (!tabStreams.has(tabId)) {
      tabStreams.set(tabId, { meta: message.payload, streams: new Map() });
    } else {
      tabStreams.get(tabId).meta = message.payload;
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "GET_TAB_STATE") {
    (async () => {
      const tabData = tabStreams.get(message.tabId) || {
        meta: { title: "", url: "", isDrm: false, hasVideoTag: false },
        streams: new Map()
      };

      const streamsWithFreshness = Array.from(tabData.streams.values())
        .map((s) => ({ ...s, freshness: checkStreamFreshness(s) }))
        .sort((a, b) => b.priority - a.priority || b.capturedAt - a.capturedAt);

      const storage = await chrome.storage.local.get([
        "licenseToken",
        "customerId",
        "subscriptionStatus"
      ]);

      sendResponse({
        meta: tabData.meta,
        streams: streamsWithFreshness,
        jobs: nativeBridge.getActiveJobs(),
        license: {
          hasLicense: Boolean(storage.licenseToken),
          status: storage.subscriptionStatus || "none",
          customerId: storage.customerId || null
        }
      });
    })();
    return true; // Async response
  }

  if (message.type === "START_DOWNLOAD") {
    (async () => {
      try {
        const { licenseToken } = await chrome.storage.local.get("licenseToken");
        if (!licenseToken) {
          sendResponse({ ok: false, error: "NO_LICENSE" });
          return;
        }

        const cookies = await getCookiesForDownload(message.url, message.pageUrl);
        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        const jobPayload = {
          type: "START_DOWNLOAD",
          jobId,
          licenseToken,
          url: message.url,
          pageUrl: message.pageUrl,
          title: message.title || "SkeletonVid_Video",
          format: message.format || "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best",
          userAgent: navigator.userAgent,
          cookies
        };

        nativeBridge.startDownload(jobPayload);
        sendResponse({ ok: true, jobId });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "CANCEL_DOWNLOAD") {
    nativeBridge.cancelDownload(message.jobId);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "ACTIVATE_LICENSE") {
    chrome.storage.local.set({
      licenseToken: message.token,
      customerId: message.customerId,
      subscriptionStatus: message.status || "trialing"
    }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
});
