## Prompt Instructions for AI Agent

You are a Senior Principal Systems & Browser Extension Engineer. Your task is to
build **SkeletonVid Pro** end-to-end in a clean monorepo following the exact
specifications in `project.md`, `tech_specs.md`, and `code_implementation.md`.

### Execution Rules

1. **Zero Placeholders or Stubs:** Write complete, production-ready code for
   every file. Do not leave `// TODO` comments or mock implementations.
2. **UI & Aesthetic Discipline:** In `extension/popup.html`,
   `extension/popup.css`, and the marketing site, use a refined, high-contrast
   dark slate interface (`#0F172A` / `#1E293B` / `#10B981`). Do not use emojis,
   floating promotional badges, or decorative gradients.
3. **Strict Native Messaging Protocol Safety:** In `native-host/main.go`, ensure
   `os.Stdout` is exclusively used for 4-byte Little-Endian length-prefixed JSON
   packets. Redirect all logs and subprocess output to internal pipes or log
   files. Always use `io.ReadFull(os.Stdin, buf)` when reading incoming
   payloads.

---

### Step-by-Step Build Plan

#### Phase 1: Initialize Monorepo & Cryptographic Keys

1. Create the directory structure:
   - `extension/` (Chrome Manifest V3 extension)
   - `native-host/` (Go cross-platform companion + installer)
   - `backend/` (Cloudflare Worker + D1 schema + Stripe integration)
   - `web/` (Marketing landing page & trial onboarding flow)
2. Write a setup script `scripts/generate-keys.mjs` (Node.js `crypto`) that:
   - Generates an RSA-2048 keypair, derives the deterministic 32-character
     Chrome Extension ID (`a`-`p` hex encoding of SHA-256 of DER public key),
     injects the base64 public key into `extension/manifest.json` (`"key"`), and
     injects the 32-char Extension ID into `native-host/main.go`.
   - Generates an Ed25519 keypair, outputting the private JWK for
     `backend/.dev.vars` and embedding the base64 public key into
     `native-host/main.go`.

#### Phase 2: Build the Chrome Extension (`extension/`)

1. Implement `manifest.json`, `content.js`, `background.js`, `popup.html`,
   `popup.css`, and `popup.js`.
2. Add the following production enhancements to `background.js` and `popup.js`:
   - **Master vs. Variant `.m3u8` Heuristics:** Score incoming manifests so
     Master playlists always sort first and receive a green badge.
   - **Token Freshness Timer:** Calculate stream age (`Date.now() - capturedAt`)
     and parse URL query strings (`Expires`, `exp`, `ttl`) to warn the user and
     offer a 1-click tab reload if the token is stale.
   - **DRM Detection:** Listen for `encrypted` media events and
     `HTMLMediaElement.mediaKeys` in `content.js` and disable download controls
     with a clear explanation when EME DRM is active.
   - **License Sync:** Add a license activation handler that listens for the
     post-checkout callback token on `SkeletonVid.pro/welcome`, stores
     `licenseToken` and `customerId` in `chrome.storage.local`, and silently
     refreshes the token via `/api/license/refresh`.
   - **Cancel Job Command:** Support sending
     `{ type: "CANCEL_DOWNLOAD", jobId }` over the native port to kill an
     in-progress `yt-dlp` subprocess cleanly.

#### Phase 3: Build the Cross-Platform Go Companion (`native-host/`)

1. Initialize `go.mod` and implement `main.go` plus platform helpers:
   - **Self-Bootstrap Binary Manager (`binaries.go`):** When `--install` is run
     (or on first download if missing), automatically check the OS app-data
     directory for `yt-dlp` and `ffmpeg`. If absent, download the official
     standalone release binary for the current OS (`runtime.GOOS` /
     `runtime.GOARCH`) with SHA-256 verification and set executable permissions
     (`0755`).
   - **Native Messaging Registration:** Support `--install` and `--uninstall`
     flags across Windows (Registry
     `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.SkeletonVid.host`),
     macOS
     (`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`), and
     Linux (`~/.config/google-chrome/NativeMessagingHosts/`).
   - **Process Management:** Track running `exec.Cmd` instances in a thread-safe
     map (`activeProcs[jobId]`) so `CANCEL_DOWNLOAD` messages or `stdin` EOF
     cleanly terminate child `yt-dlp` processes without leaving orphan
     processes.
2. Create a cross-compilation `Makefile` producing:
   - `dist/SkeletonVid-host-windows-amd64.exe`
   - `dist/SkeletonVid-host-darwin-universal`
   - `dist/SkeletonVid-host-linux-amd64`

#### Phase 4: Build the Stripe Trial & License Backend (`backend/`)

1. Create `schema.sql` for Cloudflare D1 (`users` table tracking
   `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, and
   `current_period_end`).
2. Implement `worker.ts` with endpoints:
   - `POST /api/checkout`: Creates a Stripe Checkout Session in `subscription`
     mode with `trial_period_days: 3` and `payment_method_collection: "always"`.
   - `POST /api/webhook`: Verifies `Stripe-Signature` and handles
     `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, and `invoice.paid` to keep D1 user states
     synchronized.
   - `POST /api/license/refresh`: Validates active/trialing status and returns a
     freshly signed Ed25519 token.
   - `POST /api/portal`: Creates a Stripe Billing Portal session URL so users
     can manage or cancel their subscription directly from the extension popup.

#### Phase 5: Build the Marketing & Onboarding Web App (`web/`)

1. Using the copy and SEO structure in `website_content.md`, build a fast,
   responsive static/SSR web interface (`index.html`, `welcome.html`,
   `styles.css`, `app.js`).
2. On `welcome.html`, automatically extract `session_id` after Stripe Checkout
   redirect, fetch the user's initial `licenseToken`, pass it to the installed
   Chrome Extension via `window.postMessage` (captured by `content.js` on
   `SkeletonVid.pro`), and provide OS-detected download buttons for the
   Companion Installer.

#### Phase 6: Verification & End-to-End Smoke Test

1. Run `node scripts/generate-keys.mjs` and verify that
   `extension/manifest.json` and `native-host/main.go` share matching IDs and
   public keys.
2. Compile the Go binary (`go build -o dist/SkeletonVid-host ./native-host`) and
   run `./dist/SkeletonVid-host --install` to verify the Native Messaging
   manifest JSON is written accurately.
3. Run a local test script that pipes a length-prefixed JSON `START_DOWNLOAD`
   packet with a valid signed Ed25519 token into `SkeletonVid-host` and verifies
   that `PROGRESS` and `COMPLETED` packets are emitted cleanly over `stdout`.
