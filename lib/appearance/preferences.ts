import { ACCENTS, THEME_COLOR, type AccentId, type Scheme } from "./palette";

/**
 * Appearance preferences: Light, Dark or Automatic (follows the device) plus one of six accents.
 * Stored on the device (works offline, applied before first paint) and, for signed-in people, in
 * profiles.preferences.appearance so every device they sign in to matches (see ./sync.ts).
 */
export type ThemeMode = "light" | "dark" | "system";
export type Appearance = { mode: ThemeMode; accent: AccentId; updatedAt: number };
/** Device copy. owner = the account it was last synced with (null for guests); dirty = not yet uploaded. */
export type StoredAppearance = Appearance & { owner: string | null; dirty: boolean };

export const APPEARANCE_KEY = "zest-appearance-v1";
export const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "system"];
export const DEFAULT_APPEARANCE: Appearance = { mode: "light", accent: "ocean", updatedAt: 0 };
export const ACCENT_IDS = ACCENTS.map((a) => a.id) as readonly AccentId[];

const isMode = (v: unknown): v is ThemeMode => typeof v === "string" && (THEME_MODES as readonly string[]).includes(v);
const isAccent = (v: unknown): v is AccentId => typeof v === "string" && (ACCENT_IDS as readonly string[]).includes(v);
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Validates an appearance from storage or the database. Unknown values fall back field by field; null when unusable. */
export function parseAppearance(raw: unknown): Appearance | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isMode(r.mode) && !isAccent(r.accent)) return null;
  return {
    mode: isMode(r.mode) ? r.mode : DEFAULT_APPEARANCE.mode,
    accent: isAccent(r.accent) ? r.accent : DEFAULT_APPEARANCE.accent,
    updatedAt: isTime(r.updatedAt) ? r.updatedAt : 0,
  };
}

export function readStoredAppearance(storage: Pick<Storage, "getItem">): StoredAppearance {
  try {
    const raw = JSON.parse(storage.getItem(APPEARANCE_KEY) || "null");
    const parsed = parseAppearance(raw);
    if (parsed)
      return { ...parsed, owner: typeof raw.owner === "string" ? raw.owner : null, dirty: raw.dirty === true };
  } catch {}
  return { ...DEFAULT_APPEARANCE, owner: null, dirty: false };
}

export function writeStoredAppearance(storage: Pick<Storage, "setItem">, value: StoredAppearance) {
  try {
    storage.setItem(
      APPEARANCE_KEY,
      JSON.stringify({ mode: value.mode, accent: value.accent, updatedAt: value.updatedAt, owner: value.owner, dirty: value.dirty }),
    );
  } catch {
    // Private mode / full storage: the choice still applies for this session.
  }
}

export function resolveScheme(mode: ThemeMode, systemDark: boolean): Scheme {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

export const themeColorFor = (scheme: Scheme) => THEME_COLOR[scheme];

/** Internal tools, the landing page and the premium page keep their fixed light styling; the product follows the person's appearance. */
export const followsAppearance = (pathname: string) => !/^\/((admin|upgrade)(\/|$)|$)/.test(pathname);
