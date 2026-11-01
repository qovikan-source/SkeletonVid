---

# File 3: `code_implementation.md`

````markdown
# SkeletonVid Pro — Reference Implementation Code

## 1. Repository Structure

```text
SkeletonVid-pro/
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── native-host/
│   ├── go.mod
│   └── main.go
└── backend/
    └── worker.ts
2. Chrome Extension (extension/)
extension/manifest.json
Note: Generating a static RSA public key for the "key" field locks the extension ID permanently across all machines.

JSON
{
  "manifest_version": 3,
  "name": "SkeletonVid Pro — Course & Video Downloader",
  "version": "1.0.0",
  "description": "Save online lectures, HLS streams, and videos for offline viewing in full HD.",
  "permissions": [
    "webRequest",
    "cookies",
    "nativeMessaging",
    "storage",
    "activeTab",
    "scripting"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "SkeletonVid Pro"
  }
}
extension/content.js (DOM Metadata & EME/DRM Detector)
JavaScript
(() => {
  let isDrmProtected = false;

  // Detect Encrypted Media Extensions (Widevine / FairPlay / PlayReady)
  const checkVideoElements = () => {
    const videos = document.querySelectorAll("video");
    videos.forEach((v) => {
      if (v.mediaKeys) {
        isDrmProtected = true;
      }
      v.addEventListener("encrypted", () => {
        isDrmProtected = true;
        notifyBackground();
      }, { once: true });
    });
  };

  const notifyBackground = () => {
    chrome.runtime.sendMessage({
      type: "PAGE_METADATA",
      payload: {
        title: document.title.replace(/[\\/:*?"<>|]/g, "-").trim(),
        url: window.location.href,
        isDrm: isDrmProtected,
        hasVideoTag: document.querySelectorAll("video").length > 0
      }
    }).catch(() => {});
  };

  checkVideoElements();
  notifyBackground();

  const observer = new MutationObserver(() => {
    checkVideoElements();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
extension/background.js (Stream Sniffer, Master Classifier & Persistent Native Bridge)
JavaScript
const NATIVE_HOST_NAME = "com.SkeletonVid.host";
const API_BASE_URL = "[https://api.SkeletonVid.pro](https://api.SkeletonVid.pro)";

// State maps keyed by tabId and jobId
const tabStreams = new Map(); // tabId -> { meta, streams: Map<url, StreamInfo> }
const activeJobs = new Map(); // jobId -> JobProgress
let nativePort = null;

// 1. Classify Master vs Variant Manifests
function classifyStream(url, contentType = "") {
  const lower = url.toLowerCase();
  let kind = "mp4";
  if (lower.includes(".m3u8") || contentType.includes("mpegurl")) kind = "hls";
  else if (lower.includes(".mpd") || contentType.includes("dash+xml")) kind = "dash";

  let role = "DIRECT";
  let priority = 50;

  if (kind === "hls" || kind === "dash") {
    const isVariantPattern = /(audio|video|chunklist|rendition|segment|frag|_[0-9]{3,4}p|track_[0-9])/i.test(lower);
    const isMasterPattern = /(master|playlist|manifest|index|main)\.m3u8/i.test(lower) || /\.mpd/i.test(lower);

    if (isMasterPattern && !isVariantPattern) {
      role = "MASTER";
      priority = 100;
    } else if (isVariantPattern) {
      role = "VARIANT";
      priority = 20;
    } else {
      role = "PLAYLIST";
      priority = 75;
    }
  }

  return { kind, role, priority };
}

// 2. Sniff Media Requests via webRequest
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;

    const url = details.url;
    const lowerUrl = url.toLowerCase();

    // Ignore segments (.ts, .m4s) and analytics
    if (/\.(ts|m4s|vtt|srt|jpg|png|gif|svg|woff2)(\?|$)/i.test(lowerUrl)) return;

    const contentTypeHeader = details.responseHeaders?.find(
      (h) => h.name.toLowerCase() === "content-type"
    );
    const contentType = contentTypeHeader ? contentTypeHeader.value.toLowerCase() : "";

    const isMediaUrl = /\.(m3u8|mpd|mp4|webm)(\?|$)/i.test(lowerUrl);
    const isMediaMime =
      contentType.includes("application/vnd.apple.mpegurl") ||
      contentType.includes("application/x-mpegurl") ||
      contentType.includes("application/dash+xml") ||
      contentType.includes("video/mp4") ||
      contentType.includes("video/webm");

    if (!isMediaUrl && !isMediaMime) return;

    const { kind, role, priority } = classifyStream(url, contentType);

    if (!tabStreams.has(details.tabId)) {
      tabStreams.set(details.tabId, {
        meta: { title: "Captured Video", url: "", isDrm: false },
        streams: new Map()
      });
    }

    const tabData = tabStreams.get(details.tabId);
    tabData.streams.set(url, {
      url,
      kind,
      role,
      priority,
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

// 3. Maintain Persistent Native Messaging Pipe
function ensureNativePort() {
  if (nativePort) return nativePort;

  nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);

  nativePort.onMessage.addListener((msg) => {
    if (msg.type === "PROGRESS" || msg.type === "COMPLETED" || msg.type === "ERROR") {
      activeJobs.set(msg.jobId, msg);
      chrome.runtime.sendMessage({ type: "JOB_UPDATE", payload: msg }).catch(() => {});
    }
  });

  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message || "Companion disconnected";
    nativePort = null;
    chrome.runtime.sendMessage({ type: "NATIVE_DISCONNECTED", error: err }).catch(() => {});
  });

  return nativePort;
}

// 4. Collect Cookies for Target URL + Page URL
async function getCookiesForDownload(targetUrl, pageUrl) {
  const urls = new Set([targetUrl, pageUrl].filter(Boolean));
  const cookieMap = new Map();

  for (const u of urls) {
    try {
      const list = await chrome.cookies.getAll({ url: u });
      for (const c of list) {
        cookieMap.set(`${c.domain}:${c.name}`, {
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          expirationDate: c.expirationDate ? Math.floor(c.expirationDate) : 0,
          name: c.name,
          value: c.value
        });
      }
    } catch (_) {}
  }
  return Array.from(cookieMap.values());
}

// 5. Handle Messages from Content Script & Popup
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
    const tabData = tabStreams.get(message.tabId) || {
      meta: { title: "", url: "", isDrm: false },
      streams: new Map()
    };
    const sortedStreams = Array.from(tabData.streams.values()).sort(
      (a, b) => b.priority - a.priority || b.capturedAt - a.capturedAt
    );

    sendResponse({
      meta: tabData.meta,
      streams: sortedStreams,
      jobs: Array.from(activeJobs.values())
    });
    return false;
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
        const port = ensureNativePort();

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

        activeJobs.set(jobId, {
          jobId,
          title: jobPayload.title,
          status: "starting",
          percent: 0,
          speed: "—",
          eta: "—"
        });

        port.postMessage(jobPayload);
        sendResponse({ ok: true, jobId });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // Async response
  }
});
extension/popup.html & extension/popup.js
HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>SkeletonVid Pro</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #10b981;
      --warn: #f59e0b;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 380px;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
      font-size: 13px;
      padding: 14px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .brand { font-weight: 700; font-size: 15px; letter-spacing: -0.3px; }
    .badge {
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.15);
      color: var(--accent);
    }
    .badge.warn { background: rgba(245, 158, 11, 0.15); color: var(--warn); }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
    }
    .title {
      font-weight: 600;
      margin-bottom: 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .controls { display: flex; gap: 8px; margin-top: 8px; }
    select, button {
      border-radius: 6px;
      border: 1px solid var(--border);
      padding: 7px 10px;
      font-size: 12px;
      font-weight: 600;
    }
    select { background: var(--bg); color: var(--text); flex: 1; }
    button.primary {
      background: var(--accent);
      color: #06281e;
      border: none;
      cursor: pointer;
    }
    .stream-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-top: 1px solid var(--border);
    }
    .progress-bar {
      height: 6px;
      background: var(--bg);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 6px;
    }
    .progress-fill {
      height: 100%;
      background: var(--accent);
      width: 0%;
      transition: width 0.2s ease;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      color: var(--muted);
      font-size: 11px;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">SkeletonVid Pro</div>
    <div id="licenseBadge" class="badge">Trial Active</div>
  </div>

  <!-- Primary Page Download Card -->
  <div class="card" id="pageCard">
    <div class="title" id="pageTitle">Scanning active tab...</div>
    <div id="drmWarning" style="display:none; color: var(--danger); font-size:12px;">
      This video uses hardware DRM encryption and cannot be captured.
    </div>
    <div class="controls" id="directControls">
      <select id="qualitySelect">
        <option value="bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best">1080p Full HD (MP4)</option>
        <option value="bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best">720p HD (MP4)</option>
        <option value="bestaudio[ext=m4a]/bestaudio">Audio Only (M4A)</option>
      </select>
      <button class="primary" id="downloadPageBtn">Download Page</button>
    </div>
  </div>

  <!-- Detected Course Streams -->
  <div class="card">
    <div class="title" style="font-size:12px; color:var(--muted);">Detected Course Streams (.m3u8 / .mp4)</div>
    <div id="streamList"></div>
  </div>

  <!-- Active Downloads -->
  <div class="card">
    <div class="title" style="font-size:12px; color:var(--muted);">Active Queue</div>
    <div id="jobList"></div>
  </div>

  <script src="popup.js"></script>
</body>
</html>
JavaScript
// extension/popup.js
document.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const pageTitleEl = document.getElementById("pageTitle");
  const streamListEl = document.getElementById("streamList");
  const jobListEl = document.getElementById("jobList");
  const qualitySelect = document.getElementById("qualitySelect");
  const downloadPageBtn = document.getElementById("downloadPageBtn");
  const drmWarning = document.getElementById("drmWarning");
  const directControls = document.getElementById("directControls");

  // Load state from background worker
  chrome.runtime.sendMessage({ type: "GET_TAB_STATE", tabId: tab.id }, (state) => {
    if (!state) return;

    const cleanTitle = (tab.title || "Video_Lecture").replace(/[\\/:*?"<>|]/g, "-");
    pageTitleEl.textContent = cleanTitle;

    if (state.meta?.isDrm) {
      drmWarning.style.display = "block";
      directControls.style.display = "none";
    }

    renderStreams(state.streams || [], cleanTitle, tab.url, tab.id);
    renderJobs(state.jobs || []);
  });

  // Download direct page URL (YouTube, Vimeo, Wistia, etc.)
  downloadPageBtn.addEventListener("click", () => {
    startDownload(tab.url, tab.url, tab.title, qualitySelect.value);
  });

  function startDownload(targetUrl, pageUrl, title, format) {
    chrome.runtime.sendMessage(
      { type: "START_DOWNLOAD", url: targetUrl, pageUrl, title, format },
      (res) => {
        if (!res?.ok && res?.error === "NO_LICENSE") {
          chrome.tabs.create({ url: "[https://SkeletonVid.pro/start-trial](https://SkeletonVid.pro/start-trial)" });
        }
      }
    );
  }

  function renderStreams(streams, title, pageUrl, tabId) {
    if (streams.length === 0) {
      streamListEl.innerHTML = `<div class="meta-row">Play the video to capture HLS/MP4 streams.</div>`;
      return;
    }

    streamListEl.innerHTML = "";
    streams.slice(0, 4).forEach((s) => {
      const ageSec = Math.round((Date.now() - s.capturedAt) / 1000);
      const isStale = ageSec > 180;

      const row = document.createElement("div");
      row.className = "stream-item";
      row.innerHTML = `
        <div>
          <span class="badge ${s.role === "MASTER" ? "" : "warn"}">${s.role} (${s.kind.toUpperCase()})</span>
          <div class="meta-row">${isStale ? "Token stale — refresh tab" : `Captured ${ageSec}s ago`}</div>
        </div>
        <button class="primary">${isStale ? "Refresh" : "Download"}</button>
      `;

      row.querySelector("button").addEventListener("click", () => {
        if (isStale) {
          chrome.tabs.reload(tabId);
          window.close();
        } else {
          startDownload(s.url, pageUrl, title, qualitySelect.value);
        }
      });

      streamListEl.appendChild(row);
    });
  }

  function renderJobs(jobs) {
    if (jobs.length === 0) {
      jobListEl.innerHTML = `<div class="meta-row">No active downloads.</div>`;
      return;
    }
    jobListEl.innerHTML = "";
    jobs.forEach((j) => {
      const item = document.createElement("div");
      item.style.marginTop = "8px";
      item.innerHTML = `
        <div class="meta-row">
          <strong style="color:var(--text)">${j.status.toUpperCase()}</strong>
          <span>${j.percent?.toFixed(1) || 0}% • ${j.speed || "—"} (ETA ${j.eta || "—"})</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${j.percent || 0}%"></div>
        </div>
      `;
      jobListEl.appendChild(item);
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "JOB_UPDATE") {
      chrome.runtime.sendMessage({ type: "GET_TAB_STATE", tabId: tab.id }, (state) => {
        if (state) renderJobs(state.jobs || []);
      });
    }
  });
});
3. Cross-Platform Go Native Host (native-host/main.go)
Go
package main

import (
	"bufio"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	HostName       = "com.SkeletonVid.host"
	ExtensionID    = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" // Matches manifest.json static key
	Ed25519PubKeyB64 = "REPLACE_WITH_BASE64_ED25519_PUBLIC_KEY"
)

var (
	stdoutMu    sync.Mutex
	progressRgx = regexp.MustCompile(`\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*\S+\s+at\s+(\S+)\s+ETA\s+(\S+)`)
)

type Cookie struct {
	Domain         string `json:"domain"`
	Path           string `json:"path"`
	Secure         bool   `json:"secure"`
	ExpirationDate int64  `json:"expirationDate"`
	Name           string `json:"name"`
	Value          string `json:"value"`
}

type IncomingMessage struct {
	Type         string   `json:"type"`
	JobID        string   `json:"jobId"`
	LicenseToken string   `json:"licenseToken"`
	URL          string   `json:"url"`
	PageURL      string   `json:"pageUrl"`
	Title        string   `json:"title"`
	Format       string   `json:"format"`
	UserAgent    string   `json:"userAgent"`
	Cookies      []Cookie `json:"cookies"`
}

type OutgoingMessage struct {
	Type     string  `json:"type"`
	JobID    string  `json:"jobId"`
	Status   string  `json:"status"`
	Percent  float64 `json:"percent"`
	Speed    string  `json:"speed"`
	ETA      string  `json:"eta"`
	Filepath string  `json:"filepath,omitempty"`
	Error    string  `json:"error,omitempty"`
}

type LicensePayload struct {
	Sub string `json:"sub"`
	Exp int64  `json:"exp"`
}

func main() {
	installFlag := flag.Bool("install", false, "Register Chrome Native Messaging Host")
	flag.Parse()

	if *installFlag {
		if err := installHostManifest(); err != nil {
			fmt.Fprintf(os.Stderr, "Install failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("SkeletonVid Companion successfully registered with Chrome.")
		return
	}

	// Native Messaging stdio loop
	for {
		var length uint32
		if err := binary.Read(os.Stdin, binary.LittleEndian, &length); err != nil {
			if err == io.EOF {
				break
			}
			os.Exit(1)
		}

		payload := make([]byte, length)
		if _, err := io.ReadFull(os.Stdin, payload); err != nil {
			os.Exit(1)
		}

		var msg IncomingMessage
		if err := json.Unmarshal(payload, &msg); err != nil {
			continue
		}

		if msg.Type == "START_DOWNLOAD" {
			go handleDownload(msg)
		}
	}
}

func sendMessage(msg OutgoingMessage) {
	stdoutMu.Lock()
	defer stdoutMu.Unlock()

	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	_ = binary.Write(os.Stdout, binary.LittleEndian, uint32(len(data)))
	_, _ = os.Stdout.Write(data)
}

func verifyLicense(token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return false
	}
	payloadBytes, err1 := base64.RawURLEncoding.DecodeString(parts[0])
	sigBytes, err2 := base64.RawURLEncoding.DecodeString(parts[1])
	pubKeyBytes, err3 := base64.StdEncoding.DecodeString(Ed25519PubKeyB64)
	if err1 != nil || err2 != nil || err3 != nil || len(pubKeyBytes) != ed25519.PublicKeySize {
		return false
	}

	if !ed25519.Verify(pubKeyBytes, payloadBytes, sigBytes) {
		return false
	}

	var claims LicensePayload
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return false
	}
	return time.Now().Unix() < claims.Exp
}

func handleDownload(msg IncomingMessage) {
	if !verifyLicense(msg.LicenseToken) {
		sendMessage(OutgoingMessage{
			Type:   "ERROR",
			JobID:  msg.JobID,
			Status: "error",
			Error:  "Subscription or 3-day trial expired.",
		})
		return
	}

	homeDir, _ := os.UserHomeDir()
	downloadDir := filepath.Join(homeDir, "Downloads", "SkeletonVid")
	_ = os.MkdirAll(downloadDir, 0755)

	// Write temporary Netscape cookies file for authenticated LMS sessions
	cookieFile, err := os.CreateTemp("", "sv_cookies_*.txt")
	if err == nil {
		defer os.Remove(cookieFile.Name())
		fmt.Fprintln(cookieFile, "# Netscape HTTP Cookie File")
		for _, c := range msg.Cookies {
			includeSub := "TRUE"
			if !strings.HasPrefix(c.Domain, ".") {
				includeSub = "FALSE"
			}
			sec := "FALSE"
			if c.Secure {
				sec = "TRUE"
			}
			fmt.Fprintf(cookieFile, "%s\t%s\t%s\t%s\t%d\t%s\t%s\n",
				c.Domain, includeSub, c.Path, sec, c.ExpirationDate, c.Name, c.Value)
		}
		cookieFile.Close()
	}

	outTemplate := filepath.Join(downloadDir, fmt.Sprintf("%s.%%(ext)s", msg.Title))
	args := []string{
		"--newline",
		"--no-colors",
		"--concurrent-fragments", "4",
		"--merge-output-format", "mp4",
		"-f", msg.Format,
		"-o", outTemplate,
	}

	if msg.UserAgent != "" {
		args = append(args, "--user-agent", msg.UserAgent)
	}
	if msg.PageURL != "" {
		args = append(args, "--referer", msg.PageURL)
	}
	if cookieFile != nil {
		args = append(args, "--cookies", cookieFile.Name())
	}
	args = append(args, msg.URL)

	cmd := exec.Command("yt-dlp", args...)
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		sendMessage(OutgoingMessage{Type: "ERROR", JobID: msg.JobID, Status: "error", Error: err.Error()})
		return
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		sendMessage(OutgoingMessage{Type: "ERROR", JobID: msg.JobID, Status: "error", Error: "yt-dlp binary not found"})
		return
	}

	scanner := bufio.NewScanner(stdoutPipe)
	for scanner.Scan() {
		line := scanner.Text()
		matches := progressRgx.FindStringSubmatch(line)
		if len(matches) == 4 {
			pct, _ := strconv.ParseFloat(matches[1], 64)
			sendMessage(OutgoingMessage{
				Type:    "PROGRESS",
				JobID:   msg.JobID,
				Status:  "downloading",
				Percent: pct,
				Speed:   matches[2],
				ETA:     matches[3],
			})
		}
	}

	if err := cmd.Wait(); err != nil {
		sendMessage(OutgoingMessage{Type: "ERROR", JobID: msg.JobID, Status: "error", Error: "Download process failed"})
		return
	}

	sendMessage(OutgoingMessage{
		Type:     "COMPLETED",
		JobID:    msg.JobID,
		Status:   "completed",
		Percent:  100.0,
		Speed:    "Done",
		ETA:      "00:00",
		Filepath: downloadDir,
	})
}

func installHostManifest() error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}

	manifest := map[string]interface{}{
		"name":        HostName,
		"description": "SkeletonVid Pro Native Companion",
		"path":        exePath,
		"type":        "stdio",
		"allowed_origins": []string{
			fmt.Sprintf("chrome-extension://%s/", ExtensionID),
		},
	}

	data, _ := json.MarshalIndent(manifest, "", "  ")
	home, _ := os.UserHomeDir()

	switch runtime.GOOS {
	case "darwin":
		dir := filepath.Join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts")
		_ = os.MkdirAll(dir, 0755)
		return os.WriteFile(filepath.Join(dir, HostName+".json"), data, 0644)
	case "linux":
		dir := filepath.Join(home, ".config", "google-chrome", "NativeMessagingHosts")
		_ = os.MkdirAll(dir, 0755)
		return os.WriteFile(filepath.Join(dir, HostName+".json"), data, 0644)
	case "windows":
		dir := filepath.Dir(exePath)
		manifestPath := filepath.Join(dir, HostName+".json")
		if err := os.WriteFile(manifestPath, data, 0644); err != nil {
			return err
		}
		regKey := `HKCU\Software\Google\Chrome\NativeMessagingHosts\` + HostName
		return exec.Command("reg", "add", regKey, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f").Run()
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}
4. Stripe Trial & License Backend (backend/worker.ts)
TypeScript
import Stripe from "stripe";

export interface Env {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string; // $5.00/month price_...
  ED25519_PRIVATE_KEY_JWK: string;
  DB: D1Database;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2026-09-30.endive" as any });

    // 1. Create Checkout Session (3-Day Free Trial + Card Upfront -> $5/mo)
    if (url.pathname === "/api/checkout" && req.method === "POST") {
      const { email } = await req.json() as { email: string };

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: email,
        payment_method_collection: "always", // Require card upfront
        line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
        subscription_data: {
          trial_period_days: 3,
          trial_settings: {
            end_behavior: { missing_payment_method: "cancel" }
          }
        },
        success_url: "[https://SkeletonVid.pro/welcome?session_id=](https://SkeletonVid.pro/welcome?session_id=){CHECKOUT_SESSION_ID}",
        cancel_url: "[https://SkeletonVid.pro/pricing](https://SkeletonVid.pro/pricing)"
      });

      return Response.json({ url: session.url });
    }

    // 2. Exchange Session / Email for Signed Ed25519 License Token
    if (url.pathname === "/api/license/refresh" && req.method === "POST") {
      const { customerId } = await req.json() as { customerId: string };
      const user = await env.DB.prepare(
        "SELECT subscription_status, current_period_end FROM users WHERE stripe_customer_id = ?"
      ).bind(customerId).first();

      if (!user || !["trialing", "active"].includes(user.subscription_status as string)) {
        return Response.json({ error: "No active subscription or trial" }, { status: 403 });
      }

      const token = await signEd25519License(customerId, Number(user.current_period_end), env.ED25519_PRIVATE_KEY_JWK);
      return Response.json({ licenseToken: token, status: user.subscription_status });
    }

    return new Response("Not Found", { status: 404 });
  }
};

async function signEd25519License(sub: string, exp: number, privateJwkJson: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(privateJwkJson),
    { name: "Ed25519" },
    false,
    ["sign"]
  );

  const payload = JSON.stringify({ sub, exp });
  const payloadB64 = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sigBuffer = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(payloadB64));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return `${payloadB64}.${sigB64}`;
}
```
````
