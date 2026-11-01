# SkeletonVid Pro — Product & Business Specification

## 1. Product Vision

SkeletonVid Pro is a hybrid Chrome Extension (Manifest V3) and cross-platform
Native Companion application (Windows, macOS, Linux) that allows students,
researchers, and professionals to save non-DRM video lectures, webinars, and
online media for offline viewing.

By combining an in-browser network/auth sniffer with a compiled Go native host
orchestrating `yt-dlp` and `ffmpeg`, SkeletonVid Pro downloads fragmented HLS
(`.m3u8`), DASH (`.mpd`), direct media (`.mp4`/`.webm`), and adaptive platform
streams at native multi-threaded speeds without consuming browser RAM.

---

## 2. Monetization & Subscription Model

- **Offer Structure:** 3-Day Free Trial (credit card required upfront),
  automatically converting to **$5.00/month** recurring billing.
- **Payment Infrastructure:** Stripe Checkout (`mode: "subscription"`) + Stripe
  Billing + Stripe Customer Portal.
- **Trial Mechanics:**
  1. User installs the extension and clicks **"Start 3-Day Free Trial"**.
  2. Stripe Checkout collects payment details upfront
     (`payment_method_collection: "always"`) with
     `subscription_data.trial_period_days: 3`.
  3. Upon checkout completion, our backend issues a cryptographically signed
     **Ed25519 JWT License Token** valid for 72 hours.
  4. When the trial expires, Stripe automatically charges $5.00 for the first
     month (`invoice.paid` webhook), and the extension silently refreshes the
     user's JWT for the next billing cycle.
  5. Users can cancel anytime in 2 clicks via the integrated Stripe Customer
     Portal link inside the extension popup.

---

## 3. Double-Gate Anti-Piracy & License Verification

Because Chrome Extension source code (`.js`) is readable on the client machine,
checking subscription status solely in JavaScript is trivial to bypass.
SkeletonVid Pro enforces a **Double-Gate Licensing Architecture**:

1. **Gate 1 (Extension UI):** Checks the cached JWT to unlock the download
   controls in the popup.
2. **Gate 2 (Compiled Go Native Binary):** Every `start_download` command sent
   over `chrome.runtime.connectNative()` must include the user's signed JWT. The
   compiled Go binary contains the embedded Ed25519 public key and verifies the
   token signature and expiration timestamp before spawning `yt-dlp`.

---

## 4. Distribution & Store Compliance Strategy

Google strictly prohibits extensions on the Chrome Web Store (CWS) from
downloading YouTube videos. To scale commercially without risking unexpected
takedowns, choose one of two distribution models:

- **Model A: Direct Website Distribution (Full Capabilities Out of the Box)**
  - Distribute both the Companion Installer and the Extension directly from your
    website (or via an enterprise policy / CRX installer / unpacked loader
    utility).
  - Zero platform restrictions; supports YouTube, Vimeo, and all non-DRM course
    portals immediately.
- **Model B: Chrome Web Store Funnel + Companion Domain Unlock**
  - Publish the extension on the Chrome Web Store as an **"HLS & Course Lecture
    Offline Archiver"**.
  - In CWS mode, the extension disables its UI button specifically on
    `youtube.com` to remain 100% compliant with Google's Developer Program
    Policies, while working on Udemy, Teachable, Kajabi, Coursera (non-DRM), and
    custom LMS sites.

---

## 5. Content Scope & DRM Boundaries

- **Supported:** Direct HTML5 media (`.mp4`, `.webm`), HTTP Live Streaming
  (`.m3u8` Master and Variant playlists), MPEG-DASH (`.mpd`), Vimeo, Wistia,
  Bunny Stream, Loom, Teachable, Thinkific, Kajabi, and YouTube.
- **Explicitly Excluded (DRM Compliance):** Streams encrypted with hardware or
  software DRM (Widevine, Apple FairPlay, Microsoft PlayReady) via Encrypted
  Media Extensions (EME). When the content script detects an active `MediaKeys`
  / EME session on a `<video>` element, the extension displays a clear badge
  (`DRM Protected — Cannot Download`) rather than downloading unplayable
  ciphertext.

---

## 6. End-to-End User Journey

1. **Onboarding:** User visits the landing page, starts the 3-day free trial via
   Stripe Checkout, and downloads the 1-click Companion Installer for Windows,
   macOS, or Linux.
2. **Auto-Setup:** Running the Companion Installer registers the Native
   Messaging Host with Chrome and downloads the latest `yt-dlp` and `ffmpeg`
   binaries into the local app data directory.
3. **Capture:** User logs into their course portal or video platform and presses
   Play. The extension badge lights up (`1`) indicating a valid master stream
   has been captured.
4. **Download:** User opens the popup, selects `1080p MP4`, and clicks
   **Download**. The progress bar updates in real time (`45% • 14.2 MB/s`) even
   if the popup is closed and reopened.
5. **Completion:** The merged `.mp4` file lands cleanly in the user's system
   `Downloads/SkeletonVid` folder.
