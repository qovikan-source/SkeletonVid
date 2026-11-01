/**
 * cookieHelper.js - SkeletonVid Pro
 * Securely extracts authenticated session cookies for course LMS downloads.
 */

export async function getCookiesForDownload(targetUrl, pageUrl) {
  const urls = new Set([targetUrl, pageUrl].filter(Boolean));
  const cookieMap = new Map();

  for (const u of urls) {
    try {
      const list = await chrome.cookies.getAll({ url: u });
      for (const c of list) {
        const key = `${c.domain}:${c.path}:${c.name}`;
        if (!cookieMap.has(key)) {
          cookieMap.set(key, {
            domain: c.domain,
            path: c.path,
            secure: Boolean(c.secure),
            expirationDate: c.expirationDate ? Math.floor(c.expirationDate) : 0,
            name: c.name,
            value: c.value
          });
        }
      }
    } catch (err) {
      console.warn(`[SkeletonVid:CookieHelper] Failed to read cookies for ${u}:`, err);
    }
  }

  return Array.from(cookieMap.values());
}
