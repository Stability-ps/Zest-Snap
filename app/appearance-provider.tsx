"use client";
import { useEffect } from "react";
import { getAppearance, replaceAppearance, startAppearance } from "@/lib/appearance/client";
import { syncAppearanceOnce, supabaseAppearanceRemote } from "@/lib/appearance/sync";

const RESYNC_AFTER = 60_000;

/**
 * Keeps the page's appearance live (OS changes, other tabs, app resume) and in sync with the signed-in
 * account. Renders nothing. The first paint is handled by APPEARANCE_BOOT_SCRIPT in the root layout.
 */
export default function AppearanceProvider() {
  useEffect(() => {
    const stop = startAppearance();
    let disposed = false;
    let userId: string | null = null;
    let running = false;
    let again = false;
    let lastSync = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribeAuth: (() => void) | undefined;

    const sync = async () => {
      if (disposed || !userId || !navigator.onLine) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const db = createClient();
        await syncAppearanceOnce({
          userId,
          remote: supabaseAppearanceRemote(db as never, userId),
          read: getAppearance,
          replace: (next) => {
            if (!disposed) replaceAppearance(next);
          },
        });
        // Interests (Settings › What you snap) ride the same sync: newest copy wins (lib/interests.ts).
        const { syncInterests } = await import("@/lib/interests");
        if (!disposed) await syncInterests(db as never, userId);
        lastSync = Date.now();
      } catch {
        // Supabase unavailable: the device copy stays authoritative until the next attempt.
      } finally {
        running = false;
        if (again) {
          again = false;
          void sync();
        }
      }
    };
    const soon = (delay = 500) => {
      clearTimeout(timer);
      timer = setTimeout(() => void sync(), delay);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastSync > RESYNC_AFTER) soon(0);
    };
    const onLocalChange = () => soon();
    const onOnline = () => soon(0);
    const onResume = () => onVisible();

    window.addEventListener("zest-appearance-changed", onLocalChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("zest-app-resume", onResume);
    document.addEventListener("visibilitychange", onVisible);

    (async () => {
      const { isSupabaseConfigured, createClient } = await import("@/lib/supabase/client");
      if (!isSupabaseConfigured() || disposed) return;
      const db = createClient();
      const { data } = await db.auth.getSession().catch(() => ({ data: { session: null } }));
      if (disposed) return;
      userId = data.session?.user.id ?? null;
      soon(0);
      const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
        const next = session?.user.id ?? null;
        if (next === userId) return;
        userId = next;
        // A different person signed in: adopt their saved appearance. Signing out keeps the current look.
        soon(0);
      });
      unsubscribeAuth = () => sub.subscription.unsubscribe();
      if (disposed) unsubscribeAuth();
    })().catch(() => undefined);

    return () => {
      disposed = true;
      clearTimeout(timer);
      stop();
      unsubscribeAuth?.();
      window.removeEventListener("zest-appearance-changed", onLocalChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("zest-app-resume", onResume);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
