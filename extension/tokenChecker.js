/**
 * tokenChecker.js - SkeletonVid Pro
 * Tracks stream freshness and parses expiring CDN query tokens.
 */

const MAX_STREAM_AGE_MS = 120_000; // 2 minutes

export function checkStreamFreshness(stream) {
  const now = Date.now();
  const ageMs = now - (stream.capturedAt || now);
  const ageSec = Math.max(0, Math.round(ageMs / 1000));

  let parsedExpiry = null;
  try {
    const urlObj = new URL(stream.url);
    const searchParams = urlObj.searchParams;

    const expStr =
      searchParams.get("Expires") ||
      searchParams.get("exp") ||
      searchParams.get("ttl") ||
      searchParams.get("token_expiry");

    if (expStr) {
      const expNum = parseInt(expStr, 10);
      if (!isNaN(expNum)) {
        // Handle UNIX timestamp in seconds vs milliseconds
        parsedExpiry = expNum < 10_000_000_000 ? expNum * 1000 : expNum;
      }
    }
  } catch (err) {
    console.warn("[SkeletonVid:TokenChecker] Could not parse stream URL:", err);
  }

  const isExpiredByToken = parsedExpiry !== null && now >= parsedExpiry;
  const isExpiredByAge = ageMs > MAX_STREAM_AGE_MS;
  const isStale = isExpiredByToken || isExpiredByAge;

  let reason = "Fresh";
  if (isExpiredByToken) {
    reason = "Token expired by CDN query param";
  } else if (isExpiredByAge) {
    reason = `Stream captured ${ageSec}s ago (>120s)`;
  }

  return {
    ageSec,
    isStale,
    reason,
    expiresAt: parsedExpiry
  };
}
