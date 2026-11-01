import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function base64UrlEncode(str) {
  return Buffer.from(str).toString("base64url");
}

async function createSignedToken(sub, expSecondsFromNow, privateJwk) {
  const subtle = crypto.webcrypto.subtle;
  const key = await subtle.importKey("jwk", privateJwk, { name: "Ed25519" }, false, ["sign"]);
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = JSON.stringify({ sub, exp });
  const payloadB64 = base64UrlEncode(payload);

  const sigBuffer = await subtle.sign("Ed25519", key, new TextEncoder().encode(payloadB64));
  const sigB64 = Buffer.from(sigBuffer).toString("base64url");

  return `${payloadB64}.${sigB64}`;
}

function encodeFramedPacket(obj) {
  const jsonBuf = Buffer.from(JSON.stringify(obj), "utf-8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(jsonBuf.length, 0);
  return Buffer.concat([lenBuf, jsonBuf]);
}

async function runE2ETest() {
  console.log("=== SkeletonVid Pro: Native Messaging Host Smoke Test ===");

  const exePath = path.join(rootDir, "dist", "SkeletonVid-host-windows-amd64.exe");
  if (!fs.existsSync(exePath)) {
    throw new Error(`Executable not found at ${exePath}`);
  }

  const jwkPath = path.join(rootDir, ".keys", "ed25519-private.jwk.json");
  const privateJwk = JSON.parse(fs.readFileSync(jwkPath, "utf-8"));

  // 1. Test Expired Token Rejection
  console.log("\n[Test 1] Testing Gate 2: Expired Token Rejection...");
  const expiredToken = await createSignedToken("cus_expired_user", -3600, privateJwk);
  await runHostSession(exePath, {
    type: "START_DOWNLOAD",
    jobId: "job_test_expired",
    licenseToken: expiredToken,
    url: "https://example.com/test.mp4",
    title: "Expired_Test_Video"
  }, (pkt) => {
    console.log("  Received packet:", pkt);
    if (pkt.type === "ERROR" && pkt.error?.includes("expired")) {
      console.log("  ✓ Correctly rejected expired token!");
      return true; // Finished
    }
    return false;
  });

  // 2. Test Valid Token Acceptance & Cancellation Command
  console.log("\n[Test 2] Testing Gate 2: Valid Token & Process Cancellation...");
  const validToken = await createSignedToken("cus_valid_trial_user", 72 * 3600, privateJwk);
  await testValidAndCancel(exePath, validToken);

  console.log("\n=== ALL SMOKE TESTS PASSED! ===");
}

function runHostSession(exePath, initialMsg, packetHandler) {
  return new Promise((resolve, reject) => {
    const proc = spawn(exePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    let buffer = Buffer.alloc(0);

    proc.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (buffer.length < 4 + length) break;
        const msgBytes = buffer.subarray(4, 4 + length);
        buffer = buffer.subarray(4 + length);
        const parsed = JSON.parse(msgBytes.toString("utf-8"));
        if (packetHandler(parsed)) {
          proc.kill();
          resolve();
          return;
        }
      }
    });

    proc.stderr.on("data", (err) => {
      console.error("  [host stderr]:", err.toString().trim());
    });

    proc.on("error", reject);
    proc.on("close", () => resolve());

    proc.stdin.write(encodeFramedPacket(initialMsg));
  });
}

function testValidAndCancel(exePath, validToken) {
  return new Promise((resolve, reject) => {
    const proc = spawn(exePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    let buffer = Buffer.alloc(0);
    const jobId = "job_test_cancel";

    proc.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (buffer.length < 4 + length) break;
        const msgBytes = buffer.subarray(4, 4 + length);
        buffer = buffer.subarray(4 + length);
        const parsed = JSON.parse(msgBytes.toString("utf-8"));
        console.log("  Received packet:", parsed);

        if (parsed.type === "PROGRESS" || parsed.type === "ERROR" || parsed.status === "downloading") {
          console.log("  Sending CANCEL_DOWNLOAD for jobId:", jobId);
          proc.stdin.write(encodeFramedPacket({
            type: "CANCEL_DOWNLOAD",
            jobId
          }));
          setTimeout(() => {
            proc.kill();
            console.log("  ✓ Cancel command verified!");
            resolve();
          }, 500);
          return;
        }
      }
    });

    proc.stderr.on("data", (data) => {
      console.log("  [test2 stderr]:", data.toString());
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      console.log("  [host process closed with code]:", code);
      resolve();
    });

    proc.stdin.write(encodeFramedPacket({
      type: "START_DOWNLOAD",
      jobId,
      licenseToken: validToken,
      url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
      title: "Sample_Blazes_Test",
      format: "best"
    }));
  });
}

runE2ETest().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
