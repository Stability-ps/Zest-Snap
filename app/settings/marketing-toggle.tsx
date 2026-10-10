"use client";
import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { runtime } from "@/lib/native/runtime";

/** Shown once OneSignal is configured (web push, APNs, FCM): set NEXT_PUBLIC_MARKETING_PUSH=on in Vercel. */
export const marketingPushLive = process.env.NEXT_PUBLIC_MARKETING_PUSH === "on";

export default function MarketingToggle(props: { userId: string | null; onMessage: (m: string) => void }) {
  return marketingPushLive ? <MarketingToggleRow {...props} /> : null;
}

/**
 * Settings › Preferences › Tips and offers. Marketing notifications are opt-in, separate from reminders and
 * the Daily Briefing, and can be turned off at any time. Consent is stored on the server (marketing_consent)
 * only when the device actually allowed notifications.
 */
function MarketingToggleRow({ userId, onMessage }: { userId: string | null; onMessage: (m: string) => void }) {
  const [on, setOn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return setLoaded(true);
    createClient()
      .rpc("get_marketing_consent" as never)
      .then(({ data }) => setOn(Boolean((data as { push?: boolean } | null)?.push)))
      .then(() => setLoaded(true), () => setLoaded(true));
  }, [userId]);

  async function change(next: boolean) {
    if (!userId || busy) return;
    setBusy(true);
    try {
      const m = await import("@/lib/marketing/push");
      if (next) {
        const support = m.marketingPushSupport();
        if (support === "needs_home_screen") return onMessage("On iPhone and iPad, add Zest Snap to your Home Screen first, then turn this on there.");
        if (support === "needs_app_update") return onMessage("Update Zest Snap from the App Store or Google Play to get tips and offers.");
        if (support === "unsupported") return onMessage("This browser can’t show notifications.");
        const granted = await m.enableMarketingPush(userId);
        if (!granted) return onMessage("Notifications are blocked for Zest Snap. Allow them in your settings to get tips and offers.");
        const { error } = await createClient().rpc("set_marketing_consent" as never, { p_push: true, p_platform: runtime() } as never);
        if (error) {
          await m.disableMarketingPush();
          return onMessage("Couldn’t save that. Please try again.");
        }
        m.rememberMarketingPush(userId, true);
        setOn(true);
        onMessage("Tips and offers are on. At most 2 a week, never at night.");
      } else {
        // Withdraw consent first: campaigns check it before every send, even if the device step fails.
        const { error } = await createClient().rpc("set_marketing_consent" as never, { p_push: false, p_platform: runtime() } as never);
        if (error) return onMessage("Couldn’t save that. Please try again.");
        m.rememberMarketingPush(userId, false);
        await m.disableMarketingPush();
        setOn(false);
        onMessage("Tips and offers are off. Reminders are not affected.");
      }
    } catch {
      onMessage("Notifications couldn’t be set up right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="settingsRow">
      <span className="settingsIcon"><Megaphone /></span>
      <span className="settingsRowCopy">
        <b>Tips and offers</b>
        <small>{userId ? "Rewards, scan resets and helpful nudges. At most 2 a week." : "Sign in to choose"}</small>
      </span>
      <input
        className="settingsToggle"
        type="checkbox"
        aria-label="Tips and offers notifications"
        checked={on}
        disabled={!userId || !loaded || busy}
        onChange={(e) => change(e.target.checked)}
      />
    </label>
  );
}
