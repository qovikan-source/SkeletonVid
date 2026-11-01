Markdown

# SkeletonVid Pro — Technical Specifications

## 1. System Architecture Overview

┌────────────────────────────────────────────────────────────────────────────┐ │
CHROME BROWSER (MV3) │ │ │ │ ┌───────────────────────┐ WebRequest / Cookies
┌────────────────────┐ │ │ │ Active Course / Video │ ──────────────────────► │
background.js │ │ │ │ Tab (+ EME Detector) │ │ (Service Worker) │ │ │
└───────────────────────┘ └─────────┬──────────┘ │ │ │ │ │
┌───────────────────────┐ Runtime State Sync │ Persistent │ │ │ popup.html / .js
│ ◄─────────────────────────────────┤ stdio pipe │ │ │ (React / Vanilla UI) │ │
(4-byte LE) │ │ └───────────────────────┘ ▼ │
└──────────────────────────────────────────────────────────────┼─────────────┘ │
┌──────────────────────────────────────────────────────────────┼─────────────┐ │
LOCAL OPERATING SYSTEM ▼ │ │ ┌────────────────────┐ │ │
┌───────────────────────┐ Spawns & Parses │ SkeletonVid-host │ │ │ │ yt-dlp +
ffmpeg │ ◄────────────────────── │ (Go Executable) │ │ │ │ (Managed Binaries) │
(--newline stderr) │ + Ed25519 Verifier │ │ │ └───────────┬───────────┘
└────────────────────┘ │ │ │ Writes multi-threaded fragments │ │ ▼ │ │
┌───────────────────────┐ │ │ │ ~/Downloads/ │ │ │ │ SkeletonVid/*.mp4 │ │ │
└───────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘

---

## 2. Technology Stack

- **Chrome Extension (Frontend & Sniffer):**
  - Manifest V3, Vanilla TypeScript/JavaScript (zero runtime bloat), CSS
    Variables for clean light/dark UI.
  - Permissions: `webRequest`, `cookies`, `nativeMessaging`, `storage`,
    `activeTab`, `scripting`, `downloads`, `host_permissions: ["<all_urls>"]`.
- **Native Messaging Companion (`SkeletonVid-host`):**
  - **Language:** Go 1.23+ (compiled statically for `windows/amd64`,
    `darwin/universal`, `linux/amd64`).
  - **Media Engine:** Standalone `yt-dlp` binary + static `ffmpeg` binary stored
    in OS user data (`%LOCALAPPDATA%\SkeletonVid` on Windows,
    `~/Library/Application Support/SkeletonVid` on macOS,
    `~/.local/share/SkeletonVid` on Linux).
- **Licensing & Subscription Backend:**
  - **Runtime:** Cloudflare Workers (TypeScript).
  - **Database:** Supabase (PostgreSQL) or Cloudflare D1.
  - **Payments:** Stripe Checkout + Stripe Billing (`2026-09-30` API) +
    Webhooks.
  - **Cryptography:** Ed25519 asymmetric signing (Private key in Cloudflare
    Worker secret; Public key compiled into Go binary).

---

## 3. Core Engineering Solutions to the 6 Architecture Pitfalls

### 3.1 Solving the "Silent Video" Trap (Master vs. Variant `.m3u8` Heuristics)

Course CDNs (Vimeo, Bunny, CloudFront, Wistia) request a master manifest once
and then request separate video-only and audio-only chunk lists.

- **URL Classification Engine (`background.js`):**
  - **Score +100 (`MASTER`):** URL matches
    `/master\.m3u8|playlist\.m3u8|manifest\.m3u8|index\.m3u8/i` and does NOT
    contain `/video|audio|chunklist|rendition|_[0-9]{3,4}p/i`.
  - **Score +50 (`LIKELY_MASTER`):** First `.m3u8` requested within 1,500ms of
    page navigation or player initialization.
  - **Score -50 (`VARIANT_ONLY`):** URL contains
    `/audio|video|v1|a1|720p|1080p|segment|chunk/i`.
- The UI automatically promotes `MASTER` streams to the top with a green
  `Master (Audio + Video)` badge and collapses variant tracks under an "Advanced
  Tracks" toggle.

### 3.2 Solving Expired Signed CDN URLs (Freshness Tracking)

- Every captured stream stores `capturedAt: Date.now()` and inspects query
  parameters for `Expires=`, `exp=`, or `Policy=`.
- If `(Date.now() - capturedAt) > 120_000` (2 minutes) or the parsed `exp`
  timestamp is in the past, the UI displays an amber badge:
  **`Token Stale — Click to Refresh Stream`**, which triggers
  `chrome.tabs.reload(tabId)` and auto-captures the fresh manifest.

### 3.3 Solving the 4-Byte `stdio` Framing Crash

- Chrome Native Messaging requires every message on `stdin`/`stdout` to begin
  with a 32-bit unsigned integer in native byte order (Little-Endian on x86/ARM)
  specifying the exact byte length of the UTF-8 JSON payload.
- **Rules enforced in `main.go`:**
  1. Never allow `fmt.Println` or `log.Print` to write to `os.Stdout`. Redirect
     the standard Go logger to a rotating `SkeletonVid.log` file or `os.Stderr`
     immediately at startup.
  2. When reading from `os.Stdin`, always use `io.ReadFull(os.Stdin, buf)` so
     payloads larger than the OS pipe buffer (16 KB on macOS / 64 KB on
     Linux/Windows) are never truncated mid-JSON.
  3. When spawning `yt-dlp`, redirect its `stdout` and `stderr` to internal Go
     pipes (`cmd.StdoutPipe()`, `cmd.StderrPipe()`), parse progress lines via
     regex, and emit structured JSON updates over the framed `os.Stdout` pipe.

### 3.4 Solving Disappearing Popup State

- `popup.js` never calls `chrome.runtime.connectNative()`.
- Instead, `background.js` maintains a singleton `nativePort` connection and an
  in-memory + `chrome.storage.session` map of active downloads
  (`downloads[jobId]`).
- While `nativePort` has active jobs, Chrome keeps the MV3 Service Worker alive
  continuously.
- When `popup.html` opens, it reads current jobs from `background.js` and
  subscribes to `DOWNLOAD_PROGRESS` runtime broadcasts.

### 3.5 Solving the Hardcoded Extension ID Registry Problem

- We generate an RSA-2048 keypair once during development and embed the base64
  public key into the `"key"` field of `extension/manifest.json`.
- This guarantees that the Extension ID
  (`chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/`) is **100% identical**
  across unpacked developer mode, Windows, macOS, Linux, and production builds.

### 3.6 Solving Account Rate-Limiting on Course Portals

- When downloading from authenticated course portals (`.m3u8` / `.mpd`), the Go
  host configures `yt-dlp` with `--concurrent-fragments 3` (matching normal
  browser buffering behavior), passes the exact browser `User-Agent` and
  `Referer` header, and writes session cookies to a temporary `0600` Netscape
  cookie file deleted immediately upon job completion.

---

## 4. Native Messaging JSON Protocol

### Extension -> Native Host (`stdin`)

```json
{
  "type": "START_DOWNLOAD",
  "jobId": "job_1730512000_x8k2",
  "licenseToken": "eyJhbGciOiJFZERTQSI...",
  "url": "[https://cdn.courseportal.com/lectures/104/master.m3u8](https://cdn.courseportal.com/lectures/104/master.m3u8)",
  "pageUrl": "[https://courseportal.com/courses/ai-engineering/lectures/104](https://courseportal.com/courses/ai-engineering/lectures/104)",
  "title": "04 - Building Autonomous Agents",
  "format": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best",
  "userAgent": "Mozilla/5.0 ...",
  "cookies": [
    {
      "domain": ".courseportal.com",
      "path": "/",
      "secure": true,
      "expirationDate": 1793584000,
      "name": "session_token",
      "value": "xyz987..."
    }
  ]
}
Native Host -> Extension (stdout)
JSON
{
  "type": "PROGRESS",
  "jobId": "job_1730512000_x8k2",
  "status": "downloading",
  "percent": 64.5,
  "speed": "11.8MiB/s",
  "eta": "00:14",
  "filepath": "/Users/alex/Downloads/SkeletonVid/04 - Building Autonomous Agents.mp4"
}
5. Database Schema (Supabase / PostgreSQL)
SQL
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  subscription_status TEXT NOT NULL DEFAULT 'none', -- 'trialing', 'active', 'past_due', 'canceled'
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX idx_users_email ON users(email);
```
