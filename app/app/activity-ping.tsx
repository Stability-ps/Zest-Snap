"use client";
import { useEffect } from "react";
import { sessionUserIdSync } from "@/lib/session";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { appVersionLabel, runtime } from "@/lib/native/runtime";

/** Records at most one "active today" signal per account per device per day. Renders nothing. */
export default function ActivityPing() {
  useEffect(() => {
    const userId = sessionUserIdSync();
    if (!userId || !isSupabaseConfigured()) return;
    const key = `zest-active-${userId}`;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(key) === today) return;
    } catch {}
    const timer = setTimeout(async () => {
      const db = createClient();
      const args = { p_platform: runtime(), p_app_version: (await appVersionLabel()).slice(0, 60) };
      let { error } = await db.rpc("record_activity" as never, args as never);
      // Before the platform migration is applied, fall back to the original signature.
      if (error) ({ error } = await db.rpc("record_activity" as never));
      if (!error) {
        try {
          localStorage.setItem(key, today);
        } catch {}
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
