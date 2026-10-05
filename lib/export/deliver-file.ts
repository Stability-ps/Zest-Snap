/**
 * Delivers a generated export file:
 *  - iOS/Android apps → native share sheet (preview, Save to Files/Drive, send)
 *  - touch devices / installed PWA that can share files → system share sheet
 *  - desktop browsers → a normal download, always (desktop Chrome can "share" PDFs, but the sheet opens after
 *    slow generation without a user gesture and often fails silently — people expect a file there)
 * A share failure other than the person cancelling falls back to a download instead of stopping silently.
 */
export type DeliveryResult = "shared" | "downloaded" | "cancelled";

export type DeliveryEnv = {
  shareNatively?: (blob: Blob, fileName: string, title: string) => Promise<"shared" | "cancelled" | "downloaded" | null>;
  navigator: Pick<Navigator, "canShare" | "share"> | { canShare?: undefined; share?: undefined };
  document: Pick<Document, "createElement" | "body">;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  /** Touch-first device or installed PWA, where the share sheet is the natural way to save a file. */
  prefersShareSheet: boolean;
  schedule?: (fn: () => void, ms: number) => unknown;
};

export async function deliverFile(blob: Blob, fileName: string, title: string, env: DeliveryEnv): Promise<DeliveryResult> {
  const native = await env.shareNatively?.(blob, fileName, title);
  if (native) return native === "cancelled" ? "cancelled" : "shared";

  if (env.prefersShareSheet && typeof env.navigator.canShare === "function" && typeof env.navigator.share === "function") {
    const file = new File([blob], fileName, { type: blob.type || "application/octet-stream" });
    let shareable = false;
    try {
      shareable = env.navigator.canShare({ files: [file] });
    } catch {
      shareable = false;
    }
    if (shareable) {
      try {
        await env.navigator.share({ files: [file], title });
        return "shared";
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return "cancelled";
        // NotAllowedError (gesture expired), DataError, unsupported target…: fall through to a download.
      }
    }
  }

  const url = env.createObjectURL(blob);
  const a = env.document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  env.document.body.appendChild(a);
  a.click();
  a.remove();
  (env.schedule ?? setTimeout)(() => env.revokeObjectURL(url), 60_000);
  return "downloaded";
}
