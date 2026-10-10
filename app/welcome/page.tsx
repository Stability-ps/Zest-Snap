"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import AppearanceSheet from "@/app/settings/appearance-sheet";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { appearanceStrings as t } from "@/lib/appearance/strings";

/** Only the onboarding steps that follow this one; anything else continues to the app. */
function safeNext(value: string | null) {
  return value === "/upgrade?from=onboarding" || value === "/app" ? value : "/app";
}

/**
 * One-time step for a brand-new account, right after sign-up: choose Light, Dark or Automatic and an accent
 * before using the app. Every choice applies immediately (and syncs to the account); Continue moves on to the
 * premium introduction. The default (Light, Ocean Blue) is already selected, so Continue alone is fine.
 */
export default function WelcomeAppearance() {
  const [owner, setOwner] = useState<string | null>(null);
  const [next, setNext] = useState("/app");

  useEffect(() => {
    setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
    if (!isSupabaseConfigured()) return;
    createClient()
      .auth.getSession()
      .then(({ data }) => setOwner(data.session?.user.id ?? null))
      .catch(() => undefined);
  }, []);

  return (
    <main className="welcomePage">
      <div className="welcomeWrap">
        <p className="welcomeBrand">
          Zest <span>Snap</span>
        </p>
        <p className="welcomeEyebrow">{t.welcomeEyebrow}</p>
        <h1>{t.welcomeTitle}</h1>
        <p className="welcomeIntro">{t.welcomeIntro}</p>
        <AppearanceSheet owner={owner} signedIn={Boolean(owner)} onMessage={() => undefined} showReset={false} />
        <button
          type="button"
          className="welcomeContinue"
          onClick={() => {
            // A full load, so the next page (always light, or the app in the chosen mode) paints correctly.
            window.location.assign(next);
          }}
        >
          {t.welcomeContinue} <ArrowRight size={20} aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}
