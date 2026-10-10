"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { INTEREST_IDS, type InterestId } from "@/lib/intro";
import { INTEREST_LABELS, readLocalInterests, setLocalInterests, syncInterests } from "@/lib/interests";

/** Settings › What you snap: the interests picked in the intro. Applies immediately; signed-in accounts sync. */
export default function InterestsSheet({ owner }: { owner: string | null }) {
  const [picked, setPicked] = useState<InterestId[]>(() => readLocalInterests().list);

  const toggle = async (id: InterestId) => {
    const list = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(list);
    setLocalInterests(list);
    if (owner) {
      const { createClient, isSupabaseConfigured } = await import("@/lib/supabase/client");
      if (isSupabaseConfigured()) await syncInterests(createClient() as never, owner);
    }
  };

  return (
    <div className="interestsSheet">
      <div className="interestsGrid">
        {INTEREST_IDS.map((id) => {
          const on = picked.includes(id);
          const it = INTEREST_LABELS[id];
          return (
            <button key={id} type="button" className={"interestOption" + (on ? " on" : "")} aria-pressed={on} onClick={() => void toggle(id)}>
              <span className="interestEmoji" aria-hidden="true">
                {it.emoji}
              </span>
              <b>{it.label}</b>
              <small>{it.hint}</small>
              <span className="interestTick" aria-hidden="true">
                <Check size={13} strokeWidth={3} />
              </span>
            </button>
          );
        })}
      </div>
      <small className="interestsNote">Used only to tailor Zest for you: examples, reminder timing and scan hints. Never shared.</small>
    </div>
  );
}
