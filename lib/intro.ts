/**
 * First-run intro (/intro): shown once to a brand-new device before it reaches /app.
 *
 * Returning devices are recognised by any data Zest Snap has already stored (device id, guest data,
 * appearance, reminders, planner) or a Supabase session cookie, so people who used the app before this
 * screen existed, and anyone already signed in, go straight to the app.
 */
export const INTRO_KEY = "zest-intro-v1";

/** Stored keys that prove this device has used Zest Snap before. */
export const RETURNING_KEYS = [
  "zest-device-id-v1",
  "zest-device-id",
  "zest-snap-local-v2",
  "zest-appearance-v1",
  "zest-reminders-v1",
  "zest-planner-v1",
  "zest-guest-trial-v1",
  "zest-last-app-state-v1",
];

export const INTEREST_IDS = ["school", "health", "work", "bills", "events", "travel"] as const;
export type InterestId = (typeof INTEREST_IDS)[number];

export type IntroState = { v: 1; done: true; interests: InterestId[]; at: string };

type Probe = { path: string; search: string; hasKey: (key: string) => boolean; cookie: string };

/** Pure decision, mirrored by INTRO_BOOT_SCRIPT (tests/intro.test.ts runs both against the same cases). */
export function shouldShowIntro({ path, search, hasKey, cookie }: Probe) {
  if (!/^\/app\/?$/.test(path) || search) return false; // deep links, share targets and views keep working
  if (hasKey(INTRO_KEY) || RETURNING_KEYS.some(hasKey)) return false;
  if (/(^|;\s*)sb-[^=]*-auth-token/.test(cookie)) return false;
  return true;
}

/**
 * Inline script for the /app layout: sends a brand-new device to /intro before the first paint, so the
 * Home screen never flashes first. Dependency-free and must never throw.
 */
export const INTRO_BOOT_SCRIPT = `(function(){try{
var p=location.pathname;if(!/^\\/app\\/?$/.test(p)||location.search)return;
var k=${JSON.stringify([INTRO_KEY, ...RETURNING_KEYS])};
for(var i=0;i<k.length;i++){if(localStorage.getItem(k[i])!==null)return}
if(/(^|;\\s*)sb-[^=]*-auth-token/.test(document.cookie))return;
location.replace("/intro");
}catch(e){}})();`;

export function saveIntro(interests: InterestId[]) {
  try {
    const state: IntroState = { v: 1, done: true, interests, at: new Date().toISOString() };
    localStorage.setItem(INTRO_KEY, JSON.stringify(state));
  } catch {
    // Private mode or storage blocked: the intro may show again next time, which is harmless.
  }
}

export function readIntro(): IntroState | null {
  try {
    const s = JSON.parse(localStorage.getItem(INTRO_KEY) || "null");
    return s && s.v === 1 && Array.isArray(s.interests) ? { ...s, interests: s.interests.filter((x: string) => (INTEREST_IDS as readonly string[]).includes(x)) } : null;
  } catch {
    return null;
  }
}
