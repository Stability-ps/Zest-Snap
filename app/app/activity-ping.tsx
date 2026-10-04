"use client";
import { useEffect } from "react";
import { sessionUserIdSync } from "@/lib/session";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

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
    const timer = setTimeout(() => {
      createClient()
        .rpc("record_activity" as never)
        .then(({ error }) => {
          if (!error) {
            try {
              localStorage.setItem(key, today);
            } catch {}
          }
        });
    }, 3000);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
