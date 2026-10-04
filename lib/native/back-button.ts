/**
 * Android back button policy (pure DOM logic, unit-tested):
 *  1. close the top-most open sheet/modal,
 *  2. otherwise go back in the app's own history,
 *  3. otherwise leave the app in the background (never kill it).
 */
const OVERLAYS = '[aria-modal="true"], dialog[open], .plannerOverlay, .settingsOverlay, .sheetOverlay';
const CLOSERS = '[aria-label="Close"], [aria-label^="Close "], [data-sheet-close], button.iconButton';

export type BackDecision = "closed-overlay" | "history-back" | "minimize";

export function decideBack(doc: { querySelectorAll(selector: string): ArrayLike<Element> }, canGoBack: boolean): { decision: BackDecision; target?: Element } {
  const overlays = Array.from(doc.querySelectorAll(OVERLAYS));
  const top = overlays[overlays.length - 1];
  if (top) return { decision: "closed-overlay", target: top };
  return { decision: canGoBack ? "history-back" : "minimize" };
}

export function closeOverlay(overlay: Element) {
  const closer = overlay.querySelector<HTMLElement>(CLOSERS);
  if (closer) {
    closer.click();
    return true;
  }
  // Fall back to the conventional Escape handling most sheets implement.
  overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  return false;
}
