"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNative, runtime } from "@/lib/native/runtime";
import { closeOverlay, decideBack } from "@/lib/native/back-button";
import { inAppPath, needsFullNavigation } from "@/lib/native/deep-links";

/**
 * The single integration point between the shared web app and the iOS/Android shell.
 * Renders nothing and does nothing on the web or in the PWA.
 */
export default function NativeBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!isNative()) return;
    const platform = runtime();
    document.documentElement.classList.add("native", `native-${platform}`);
    document.documentElement.dataset.runtime = platform;
    const removers: (() => void)[] = [];
    let disposed = false;
    const listen = (p: Promise<{ remove: () => Promise<void> }>) =>
      p.then((h) => {
        if (disposed) void h.remove();
        else removers.push(() => void h.remove());
      }).catch(() => undefined);

    const syncAndroidInsets = async () => {
      if (platform !== "android") return;
      try {
        const { nativeSystemInsets } = await import("@/lib/native/permissions");
        const insets = await nativeSystemInsets();
        if (!insets) return;
        const root = document.documentElement.style;
        root.setProperty("--native-safe-top", `${Math.max(0, insets.top)}px`);
        root.setProperty("--native-safe-right", `${Math.max(0, insets.right)}px`);
        root.setProperty("--native-safe-bottom", `${Math.max(0, insets.bottom)}px`);
        root.setProperty("--native-safe-left", `${Math.max(0, insets.left)}px`);
      } catch {}
    };

    /** Navigate inside the app without a full reload when the page can handle it itself. */
    const open = (path: string) => {
      if (needsFullNavigation(path)) return window.location.assign(path);
      const url = new URL(path, window.location.origin);
      if (url.pathname === "/app" && window.location.pathname === "/app") {
        window.dispatchEvent(new CustomEvent("zest-open", { detail: { url: url.pathname + url.search } }));
        return;
      }
      router.push(url.pathname + url.search + url.hash);
    };

    // Reminders → OS-scheduled local notifications, re-synced whenever reminders change or the app resumes.
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    const syncReminders = () => {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(async () => {
        try {
          const [{ listReminders }, { syncNativeReminders }] = await Promise.all([import("@/lib/reminders"), import("@/lib/native/notifications")]);
          const armed = await syncNativeReminders(await listReminders());
          // Tell the server which reminders this device will deliver itself, so they are recorded as delivered
          // on the device instead of failing for lack of a web-push subscription. Guests have nothing to report.
          if (armed.length && navigator.onLine) {
            const { createClient, isSupabaseConfigured } = await import("@/lib/supabase/client");
            if (isSupabaseConfigured()) {
              const db = createClient();
              const { data } = await db.auth.getSession();
              if (data.session) await db.rpc("mark_reminders_device_armed" as never, { p_items: armed } as never);
            }
          }
        } catch {
          // Offline or signed out: the previous schedule stays armed; next resume retries.
        }
      }, 800);
    };
    window.addEventListener("zest-reminders-changed", syncReminders);
    removers.push(() => window.removeEventListener("zest-reminders-changed", syncReminders));
    const onViewportChange = () => void syncAndroidInsets();
    window.addEventListener("resize", onViewportChange);
    removers.push(() => window.removeEventListener("resize", onViewportChange));

    (async () => {
      const [{ App }, { SplashScreen }, { StatusBar, Style }, { Keyboard }, { LocalNotifications }] = await Promise.all([
        import("@capacitor/app"),
        import("@capacitor/splash-screen"),
        import("@capacitor/status-bar"),
        import("@capacitor/keyboard"),
        import("@capacitor/local-notifications"),
      ]);
      if (disposed) return;
      // Dark status-bar icons over Zest Snap's light screens. Android still draws edge-to-edge,
      // but we publish the OS' real bar sizes as CSS variables because Samsung WebView can report
      // env(safe-area-inset-*) as zero with three-button navigation.
      StatusBar.setStyle({ style: Style.Light }).catch(() => undefined);
      if (platform === "android") {
        StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
        await syncAndroidInsets();
      }
      requestAnimationFrame(() => SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => undefined));

      listen(
        App.addListener("backButton", ({ canGoBack }) => {
          const { decision, target } = decideBack(document, canGoBack);
          if (decision === "closed-overlay" && target) closeOverlay(target);
          else if (decision === "history-back") window.history.back();
          else App.minimizeApp().catch(() => undefined);
        }),
      );
      listen(
        App.addListener("appUrlOpen", ({ url }) => {
          const path = inAppPath(url);
          if (path) open(path);
        }),
      );
      listen(
        App.addListener("resume", async () => {
          // Validate (and refresh if needed) the session after time in the background, then refresh stale data.
          try {
            const { createClient, isSupabaseConfigured } = await import("@/lib/supabase/client");
            if (isSupabaseConfigured()) await createClient().auth.getSession();
          } catch {}
          window.dispatchEvent(new Event("zest-app-resume"));
          await syncAndroidInsets();
          syncReminders();
        }),
      );
      listen(
        LocalNotifications.addListener("localNotificationActionPerformed", async ({ actionId, notification }) => {
          const extra = (notification.extra || {}) as { reminderId?: string; url?: string };
          if (extra.reminderId && (actionId === "done" || actionId === "snooze")) {
            try {
              const { markReminderHandled, snoozeReminder } = await import("@/lib/reminders");
              if (actionId === "done") await markReminderHandled(extra.reminderId);
              else await snoozeReminder(extra.reminderId, 10);
              return;
            } catch {
              // Fall through and open the reminder so the person can act on it in the app.
            }
          }
          const path = extra.url ? inAppPath(new URL(extra.url, "https://app.zestsnap.app").href) : null;
          open(path || "/app?view=planner&tab=reminders");
        }),
      );
      listen(
        Keyboard.addListener("keyboardDidShow", () => {
          const el = document.activeElement as HTMLElement | null;
          if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.scrollIntoView({ block: "center", behavior: "smooth" });
        }),
      );
      // Cold start from a link: Capacitor keeps the launch URL until asked.
      const launch = await App.getLaunchUrl().catch(() => undefined);
      const launchPath = launch?.url ? inAppPath(launch.url) : null;
      if (launchPath && launchPath !== window.location.pathname + window.location.search) open(launchPath);
      syncReminders();
    })().catch(() => undefined);

    return () => {
      disposed = true;
      clearTimeout(syncTimer);
      removers.forEach((r) => r());
    };
  }, [router]);

  return null;
}
