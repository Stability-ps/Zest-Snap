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
  if (!hasPlugin("Share")) return null;
  const { Share } = await import("@capacitor/share");
  try {
    await Share.share({ ...opts, dialogTitle: opts.title });
    return "shared";
  } catch (e) {
    if (e instanceof Error && /cancel/i.test(e.message)) return "cancelled";
    throw e;
  }
}
