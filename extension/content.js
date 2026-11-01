/**
 * content.js - SkeletonVid Pro
 * DOM metadata scraping, EME/DRM detection, and onboarding license synchronization.
 */

(() => {
  let isDrmProtected = false;
  let observer = null;

  // 1. Detect Encrypted Media Extensions (Widevine / FairPlay / PlayReady)
  const checkVideoElements = () => {
    const videos = document.querySelectorAll("video");
    videos.forEach((video) => {
      if (video.mediaKeys) {
        isDrmProtected = true;
      }
      video.addEventListener(
        "encrypted",
        () => {
          isDrmProtected = true;
          notifyBackground();
        },
        { once: true }
      );
    });
  };

  const sanitizeTitle = (title) => {
    return (title || "Course_Lecture")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  };

  const notifyBackground = () => {
    const hasVideo = document.querySelectorAll("video").length > 0;
    chrome.runtime
      .sendMessage({
        type: "PAGE_METADATA",
        payload: {
          title: sanitizeTitle(document.title),
          url: window.location.href,
          isDrm: isDrmProtected,
          hasVideoTag: hasVideo
        }
      })
      .catch((err) => {
        // Suppress benign connection errors if extension was reloaded
        if (!err.message?.includes("Extension context invalidated")) {
          console.warn("[SkeletonVid:Content] Failed to notify background:", err);
        }
      });
  };

  // 2. Listen for License Handshake from SkeletonVid Welcome/Checkout page
  const handleWindowMessage = (event) => {
    if (!event.data || typeof event.data !== "object") return;

    if (event.data.type === "SKELETONVID_LICENSE_SYNC") {
      const { token, customerId, status } = event.data;
      if (token) {
        chrome.runtime
          .sendMessage({
            type: "ACTIVATE_LICENSE",
            token,
            customerId,
            status: status || "trialing"
          })
          .then(() => {
            window.postMessage({ type: "SKELETONVID_EXTENSION_SYNCED", ok: true }, "*");
          })
          .catch((err) => {
            console.error("[SkeletonVid:Content] License activation error:", err);
          });
      }
    }
  };

  // Initial scan & dynamic observer
  checkVideoElements();
  notifyBackground();

  observer = new MutationObserver(() => {
    checkVideoElements();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("message", handleWindowMessage);

  // Clean up listeners on unload
  window.addEventListener(
    "pagehide",
    () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      window.removeEventListener("message", handleWindowMessage);
    },
    { once: true }
  );
})();
