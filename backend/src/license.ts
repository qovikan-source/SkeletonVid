/**
 * license.ts - SkeletonVid Pro
 * Signs Ed25519 JWT license tokens for Double-Gate anti-piracy verification.
 */

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return base64UrlEncode(binary);
}

export async function signEd25519License(
  sub: string,
  exp: number,
  privateJwkJson: string
): Promise<string> {
  const jwk = JSON.parse(privateJwkJson);
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "Ed25519" },
    false,
    ["sign"]
  );

  const payload = JSON.stringify({ sub, exp });
  const payloadB64 = base64UrlEncode(payload);

  const sigBuffer = await crypto.subtle.sign(
    "Ed25519",
    key,
    new TextEncoder().encode(payloadB64)
  );

  const sigB64 = bufferToBase64Url(sigBuffer);
  return `${payloadB64}.${sigB64}`;
}
