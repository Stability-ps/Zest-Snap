import { hasPlugin } from "./runtime";
import { blockedPermissionHelp } from "./permissions";

export class CaptureCancelled extends Error {}
export class CapturePermissionError extends Error {}

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
      resultType: CameraResultType.Uri,
      quality: 90,
      width: 3000,
      height: 3000,
      correctOrientation: true,
      saveToGallery: false,
      allowEditing: false,
    });
    const path = photo.webPath;
    if (!path) throw new Error("no_image");
    const blob = await (await fetch(path)).blob();
    const type = photo.format === "png" ? "image/png" : photo.format === "webp" ? "image/webp" : "image/jpeg";
    return new File([blob], `zest-scan-${Date.now()}.${type.split("/")[1]}`, { type });
  } catch (e) {
    const message = e instanceof Error ? e.message.toLowerCase() : "";
    if (message.includes("cancel")) throw new CaptureCancelled("cancelled");
    if (message.includes("denied") || message.includes("permission") || message.includes("access"))
      throw new CapturePermissionError(blockedPermissionHelp(source === "camera" ? "camera" : "photos"));
    throw e;
  }
}

export function nativeCameraAvailable() {
  return hasPlugin("Camera");
}
