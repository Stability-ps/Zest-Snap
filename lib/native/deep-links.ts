/**
 * Maps an incoming URL (universal/app link https://app.zestsnap.app/…, https://zestsnap.app/…, or the
 * zestsnap:// custom scheme) to an in-app path. Anything else is ignored so links can't navigate the
 * app to foreign sites. Pure, so it is unit-tested.
 */
const HOSTS = new Set(["app.zestsnap.app", "zestsnap.app", "www.zestsnap.app"]);
const ALLOWED = /^\/(app|login|settings|onboarding|reset-password|auth\/callback|privacy|terms|share|shared)(\/|$)/;

export function inAppPath(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  let path: string;
  if (url.protocol === "zestsnap:") {
    // zestsnap://app/planner?x → /app/planner?x ; zestsnap:///app → /app
    path = "/" + [url.hostname, url.pathname.replace(/^\/+/, "")].filter(Boolean).join("/");
  } else if (url.protocol === "https:" && HOSTS.has(url.hostname)) {
    path = url.pathname || "/";
  } else {
    return null;
  }
  if (path === "/" || path === "") path = "/app";
  if (!ALLOWED.test(path)) return null;
  return path + url.search + url.hash;
}

/** Routes that must be loaded by the server (they exchange auth codes or set cookies). */
export function needsFullNavigation(path: string) {
  return path.startsWith("/auth/callback") || path.startsWith("/reset-password");
}
