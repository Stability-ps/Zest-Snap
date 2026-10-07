import { hasPlugin } from "./runtime";

export type ShareResult = "shared" | "downloaded" | "cancelled";

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Hands a generated file (PDF, JSON…) to the native share sheet, where the person can preview it,
 * save it to Files/Drive or send it. Files are written to the app cache, never to hidden locations.
 * Returns null on the web so callers keep their existing browser behaviour.
 */
export async function shareFileNatively(blob: Blob, fileName: string, title: string): Promise<ShareResult | null> {
  if (!hasPlugin("Share") || !hasPlugin("Filesystem")) return null;
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const safeName = fileName.replace(/[^\w.\-]+/g, "-");
  const written = await Filesystem.writeFile({ path: `exports/${safeName}`, data: await toBase64(blob), directory: Directory.Cache, recursive: true });
  try {
    await Share.share({ title, files: [written.uri], dialogTitle: title });
    return "shared";
  } catch (e) {
    if (e instanceof Error && /cancel/i.test(e.message)) return "cancelled";
    throw e;
  }
}

/** Shares text/links through the native sheet; null when unavailable so callers can fall back. */
export async function shareTextNatively(opts: { title: string; text?: string; url?: string }): Promise<ShareResult | null> {
  if (hasPlugin("Share")) {
    const { Share } = await import("@capacitor/share");
    try {
      // Android shares URLs more reliably when the complete invitation is sent as text.
      // Keep the separate url field for iOS/native targets that understand it.
      const text = [opts.text, opts.url && !opts.text?.includes(opts.url) ? opts.url : ""].filter(Boolean).join("\n");
      // Do not send the same link in both text and url. Android/WhatsApp can render it twice
      // and may generate a separate preview for the url field.
      const url = opts.url && !text.includes(opts.url) ? opts.url : undefined;
      await Share.share({ title: opts.title, text: text || opts.url, url, dialogTitle: opts.title });
      return "shared";
    } catch (e) {
      if (e instanceof Error && /cancel/i.test(e.message)) return "cancelled";
      throw e;
    }
  }

  // A remote Capacitor WebView can occasionally report the native plugin bridge late.
  // Prefer the platform share sheet over silently copying to the clipboard when the browser API is available.
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      const text = [opts.text, opts.url && !opts.text?.includes(opts.url) ? opts.url : ""].filter(Boolean).join("\n");
      const url = opts.url && !text.includes(opts.url) ? opts.url : undefined;
      await navigator.share({ title: opts.title, text: text || opts.url, url });
      return "shared";
    } catch (e) {
      if (e instanceof Error && /abort|cancel/i.test(e.name + " " + e.message)) return "cancelled";
      throw e;
    }
  }
  return null;
}
