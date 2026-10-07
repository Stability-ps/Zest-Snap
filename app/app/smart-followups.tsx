"use client";

import { useEffect, useState } from "react";
import { Check, Clock3, Sparkles, X } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { PlannerItem } from "@/lib/planner";
import { createReminder } from "@/lib/reminders";

type Suggestion = {
  id: string;
  planner_item_id: string | null;
  kind: "travel" | "prepare" | "deadline" | "shopping" | "custom";
  title: string;
  scheduled_at: string | null;
  status: "suggested" | "accepted" | "dismissed" | "completed";
};

export default function SmartFollowups({
  signedIn,
  items,
  onNotice,
}: {
  signedIn: boolean;
  items: PlannerItem[];
  onNotice?: (kind: "success" | "error", message: string) => void;
}) {
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn || !isSupabaseConfigured() || !navigator.onLine) return;
    let alive = true;
    const db = createClient();
    db.from("followup_suggestions").select("id,planner_item_id,kind,title,scheduled_at,status")
      .eq("status", "suggested").order("scheduled_at", { ascending: true }).limit(4)
      .then(({ data }) => { if (alive) setRows((data || []) as Suggestion[]); });
    return () => { alive = false; };
  }, [signedIn]);

  if (!signedIn || !rows.length) return null;

  async function update(row: Suggestion, status: "accepted" | "dismissed") {
    if (busy) return;
    setBusy(row.id);
    try {
      const db = createClient();
      if (status === "accepted" && row.planner_item_id) {
        const item = items.find((x) => x.id === row.planner_item_id);
        if (item) {
          const minutes = row.kind === "travel" ? 45 : row.kind === "prepare" ? 1440 : 60;
          await createReminder(item, { preset: "custom", customMinutes: minutes }, row.title);
        }
      }
      const { error } = await db.from("followup_suggestions").update({ status }).eq("id", row.id);
      if (error) throw error;
      setRows((v) => v.filter((x) => x.id !== row.id));
      onNotice?.("success", status === "accepted" ? "Follow-up reminder added." : "Suggestion dismissed.");
    } catch (e) {
      onNotice?.("error", e instanceof Error ? e.message : "Follow-up could not be updated.");
    } finally { setBusy(null); }
  }

  return (
    <section className="smartFollowups" aria-label="Smart follow-ups">
      <div className="smartFollowupsHead"><div><Sparkles /><span><b>Smart follow-up</b><small>Useful next steps from your plans</small></span></div></div>
      {rows.map((row) => (
        <div className="smartFollowupRow" key={row.id}>
          <Clock3 />
          <span><b>{row.title}</b><small>{row.kind === "travel" ? "Travel reminder" : row.kind === "prepare" ? "Preparation reminder" : "Suggested reminder"}</small></span>
          <button disabled={busy === row.id} onClick={() => update(row, "accepted")} aria-label={"Accept " + row.title}><Check /></button>
          <button disabled={busy === row.id} onClick={() => update(row, "dismissed")} aria-label={"Dismiss " + row.title}><X /></button>
        </div>
      ))}
    </section>
  );
}
