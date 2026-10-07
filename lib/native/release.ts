/**
 * Android/iOS can resume a WebView that has been backgrounded for days, still running the JavaScript of an
 * older release. On resume we ask the server which release is live and reload onto it — but never while the
 * person is reviewing a scan or has a sheet/dialog open, so nothing in progress is lost.
 */
export const RUNNING_BUILD = process.env.NEXT_PUBLIC_ZEST_BUILD || "local";

export function hasWorkInProgress(doc: Pick<Document, "querySelector">) {
  return Boolean(doc.querySelector('.reviewTop, [role="dialog"], [aria-modal="true"]'));
}

export function shouldReloadForRelease(running: string, live: unknown, busy: boolean) {
  return typeof live === "string" && live.length > 0 && live !== "local" && running !== "local" && live !== running && !busy;
}

export async function reloadIfNewRelease(fetchImpl: typeof fetch = fetch) {
  try {
    const res = await fetchImpl("/api/version", { cache: "no-store" });
    if (!res.ok) return false;
    const { build } = (await res.json()) as { build?: unknown };
    if (!shouldReloadForRelease(RUNNING_BUILD, build, hasWorkInProgress(document))) return false;
    window.location.reload();
    return true;
  } catch {
    return false; // Offline: keep the running build.
  }
}
