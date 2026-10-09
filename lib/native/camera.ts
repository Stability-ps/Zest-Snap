import { hasPlugin } from "./runtime";
import { blockedPermissionHelp } from "./permissions";

export class CaptureCancelled extends Error {}
export class CapturePermissionError extends Error {}
/** Any other native failure. Its message is customer-facing; the plugin's own text is only logged. */
export class CaptureUnavailable extends Error {}

/**
 * Sorts a native camera/photo-picker failure into cancelled, permission or unavailable. Plugin messages are
 * developer text (e.g. "You are missing NSPhotoLibraryAddUsageDescription in your Info.plist file") and are
 * never shown to customers. Pure, so it is unit-tested.
 */
export function classifyCaptureError(e: unknown, source: "camera" | "photos"): Error {
  const message = e instanceof Error ? e.message.toLowerCase() : String(e ?? "").toLowerCase();
  if (message.includes("cancel")) return new CaptureCancelled("cancelled");
  if (message.includes("info.plist") || message.includes("usagedescription") || message.includes("not implemented") || message.includes("not available"))
    return new CaptureUnavailable(source === "camera" ? "The camera couldn’t open. Try Upload instead." : "Your photos couldn’t open. Try Upload instead.");
  if (message.includes("denied") || message.includes("permission") || message.includes("access"))
    return new CapturePermissionError(blockedPermissionHelp(source === "camera" ? "camera" : "photos"));
  return new CaptureUnavailable(source === "camera" ? "The camera couldn’t open. Try Upload instead." : "Your photos couldn’t open. Try Upload instead.");
}

/**
 * Native photo capture / photo-library pick for the scanner. Returns a File so it flows through the
 * existing scan pipeline unchanged (which compresses images before upload).
 * Quality is kept high and the long edge capped at 3000px, so AI extraction keeps fine print legible.
 */
export async function capturePhoto(source: "camera" | "photos"): Promise<File> {
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  try {
    const photo = await Camera.getPhoto({
      source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
      // Base64, not Uri: the app is served from https://app.zestsnap.app/app and Capacitor answers fetches of
      // capacitor://localhost/_capacitor_file_ with Access-Control-Allow-Origin set to that full URL (path
      // included), which never matches the page origin, so fetch(webPath) is blocked by CORS.
      resultType: CameraResultType.Base64,
      quality: 90,
      width: 3000,
      height: 3000,
      correctOrientation: true,
      saveToGallery: false,
      allowEditing: false,
    });
    return photoFile(photo.base64String, photo.format);
  } catch (e) {
    const sorted = classifyCaptureError(e, source);
    if (sorted instanceof CaptureUnavailable) console.warn("[camera]", e);
    throw sorted;
  }
}

/** Turns the plugin's base64 result into a File for the scan pipeline. Pure, so it is unit-tested. */
export function photoFile(base64: string | undefined, format: string | undefined, now = Date.now()): File {
  if (!base64) throw new Error("no_image");
  const type = format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg";
  const binary = atob(base64.replace(/^data:[^,]*,/, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], `zest-scan-${now}.${type.split("/")[1]}`, { type });
}

export function nativeCameraAvailable() {
  return hasPlugin("Camera");
}
