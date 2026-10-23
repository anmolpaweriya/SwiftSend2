/**
 * Detects device or platform name from browser userAgent / client hints.
 * Returns intuitive names like "Samsung Device", "Windows PC", "iPhone", etc.
 */
export function getDeviceDefaultName(): string {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "Device";
  }

  const ua = navigator.userAgent || "";
  const platform =
    (navigator as any).userAgentData?.platform || navigator.platform || "";

  // 1. Apple devices (iOS / iPadOS)
  if (
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1)
  ) {
    if (
      /iPad/.test(ua) ||
      (platform === "MacIntel" && navigator.maxTouchPoints > 1)
    ) {
      return "iPad";
    }
    return "iPhone";
  }

  // 2. Android devices & specific popular vendors
  if (/Android/i.test(ua)) {
    // Samsung
    if (/SAMSUNG|SM-|GT-|SCH-/i.test(ua)) {
      const smMatch = ua.match(/SM-([A-Z0-9]+)/i);
      return smMatch ? `Samsung ${smMatch[1]}` : "Samsung Galaxy";
    }
    // Google Pixel
    if (/Pixel/i.test(ua)) {
      const pixelMatch = ua.match(/Pixel(\s[0-9a-zA-Z\s]+)?/i);
      if (pixelMatch) {
        const p = pixelMatch[0].trim();
        return p.toLowerCase().startsWith("google") ? p : `Google ${p}`;
      }
      return "Google Pixel";
    }
    // OnePlus
    if (/OnePlus|GM19/i.test(ua)) {
      return "OnePlus";
    }
    // Xiaomi / Redmi / POCO
    if (/POCO/i.test(ua)) return "POCO";
    if (/Redmi/i.test(ua)) return "Redmi";
    if (/Xiaomi|Mi\s/i.test(ua)) return "Xiaomi";
    // Motorola
    if (/Motorola|Moto/i.test(ua)) return "Motorola";
    // OPPO / Vivo / Realme
    if (/OPPO|CPH/i.test(ua)) return "OPPO";
    if (/vivo|V2/i.test(ua)) return "Vivo";
    if (/Realme|RMX/i.test(ua)) return "Realme";

    return "Android Phone";
  }

  // 3. Apple macOS
  if (/Macintosh|Mac OS X/i.test(ua) || /Mac/i.test(platform)) {
    return "Mac";
  }

  // 4. Windows PC
  if (/Windows/i.test(ua) || /Win/i.test(platform)) {
    return "Windows PC";
  }

  // 5. ChromeOS
  if (/CrOS/i.test(ua)) {
    return "Chromebook";
  }

  // 6. Linux PC
  if (/Linux/i.test(ua) || /Linux/i.test(platform)) {
    return "Linux PC";
  }

  return "My Device";
}
