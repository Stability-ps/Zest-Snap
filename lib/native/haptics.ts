import { hasPlugin } from "./runtime";

/** Subtle confirmation haptics, native only. Never throws. */
export async function hapticSuccess() {
  if (!hasPlugin("Haptics")) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Success });
  } catch {}
}

export async function hapticLight() {
  if (!hasPlugin("Haptics")) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {}
}
