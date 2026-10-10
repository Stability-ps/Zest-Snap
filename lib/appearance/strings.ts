import type { AccentId } from "./palette";
import type { ThemeMode } from "./preferences";

/**
 * Every user-facing string of the appearance settings, in one place so a translation layer can swap the
 * whole object. Labels are kept short; the layout wraps (never truncates) longer translations.
 */
export const appearanceStrings = {
  rowTitle: "Appearance",
  rowHint: "Light, Dark or Automatic and your colour",
  sheetTitle: "Appearance",
  sheetIntro: "Choose how Zest Snap looks on this device and every device you sign in to.",
  modeHeading: "Display mode",
  modes: {
    light: { label: "Light", hint: "Always light" },
    dark: { label: "Dark", hint: "Always dark" },
    system: { label: "Automatic", hint: "Matches your device" },
  } satisfies Record<ThemeMode, { label: string; hint: string }>,
  accentHeading: "Accent colour",
  accents: {
    ocean: "Ocean Blue",
    teal: "Teal",
    violet: "Violet",
    rose: "Rose",
    amber: "Amber",
    slate: "Slate",
  } satisfies Record<AccentId, string>,
  selected: "selected",
  previewHeading: "Preview",
  previewScan: "Scan a photo",
  previewTaskTitle: "Parent evening",
  previewTaskMeta: "Today · 18:00",
  previewProgress: "3 of 4 done this week",
  resetButton: "Reset appearance",
  resetHint: "Automatic mode and Ocean Blue",
  resetDone: "Appearance reset",
  savedSignedIn: "Saved to your account",
  savedDevice: "Saved on this device",
};

export function appearanceSummary(mode: ThemeMode, accent: AccentId) {
  return `${appearanceStrings.modes[mode].label} · ${appearanceStrings.accents[accent]}`;
}
