/**
 * streamClassifier.js - SkeletonVid Pro
 * Classifies media streams into Master, Variant, Direct, or Playlist.
 */

export function classifyStream(url, contentType = "") {
  const lowerUrl = url.toLowerCase();
  const lowerMime = (contentType || "").toLowerCase();

  let kind = "mp4";
  if (lowerUrl.includes(".m3u8") || lowerMime.includes("mpegurl")) {
    kind = "hls";
  } else if (lowerUrl.includes(".mpd") || lowerMime.includes("dash+xml")) {
    kind = "dash";
  } else if (lowerUrl.includes(".webm") || lowerMime.includes("video/webm")) {
    kind = "webm";
  }

  let role = "DIRECT";
  let priority = 50;

  if (kind === "hls" || kind === "dash") {
    const isVariantPattern =
      /(audio|video|chunklist|rendition|segment|frag|_[0-9]{3,4}p|track_[0-9]|v[0-9]|a[0-9])/i.test(
        lowerUrl
      );
    const isMasterPattern =
      /(master|playlist|manifest|index|main)\.m3u8/i.test(lowerUrl) ||
      /\.mpd/i.test(lowerUrl);

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

export function isMediaRequest(url, contentType = "") {
  const lowerUrl = url.toLowerCase();
  const lowerMime = (contentType || "").toLowerCase();

  // Reject segments and non-media static assets
  if (/\.(ts|m4s|vtt|srt|jpg|jpeg|png|gif|svg|woff|woff2|css|js)(\?|$)/i.test(lowerUrl)) {
    return false;
  }

  const isMediaUrl = /\.(m3u8|mpd|mp4|webm)(\?|$)/i.test(lowerUrl);
  const isMediaMime =
    lowerMime.includes("application/vnd.apple.mpegurl") ||
    lowerMime.includes("application/x-mpegurl") ||
    lowerMime.includes("application/dash+xml") ||
    lowerMime.includes("video/mp4") ||
    lowerMime.includes("video/webm");

  return isMediaUrl || isMediaMime;
}
