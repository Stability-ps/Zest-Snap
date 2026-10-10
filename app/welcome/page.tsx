"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import AppearanceSheet from "@/app/settings/appearance-sheet";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { appearanceStrings as t } from "@/lib/appearance/strings";
import { readIntro } from "@/lib/intro";

/** Only the onboarding steps that follow this one; anything else continues to the app. */
function safeNext(value: string | null) {
  return value === "/upgrade?from=onboarding" || value === "/app" ? value : "/app";
}

/**
 * One-time step for a brand-new account, right after sign-up (skipped when the first-run intro, which has the same
 * picker, was completed on this device): choose Light, Dark or Automatic and an accent
 * before using the app. Every choice applies immediately (and syncs to the account); Continue moves on to the
 * premium introduction. The default (Light, Ocean Blue) is already selected, so Continue alone is fine.
 */
export default function WelcomeAppearance() {
  const [owner, setOwner] = useState<string | null>(null);
  const [next, setNext] = useState("/app");

  useEffect(() => {
    const target = safeNext(new URLSearchParams(window.location.search).get("next"));
    // Already chose a look in the first-run intro on this device: don't ask twice. That choice carries into the
    // new account (lib/appearance/sync.ts seeds a brand-new account from the device's appearance).
    if (readIntro()) {
      window.location.replace(target);
      return;
    }
    setNext(target);
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
