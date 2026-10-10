"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeAuthNext } from "@/lib/auth";
import { claimPendingReferral, registerDevice, setActiveUser } from "@/lib/session";
import { socialDisplayName } from "@/lib/social-auth";

/**
 * Finishes a Google or Apple sign-in after /auth/callback created the session: the same steps as an email
 * sign-in (switch the device to this account, register the device, claim a pending referral), plus keeping
 * the display name sensible. Guest data on this device moves to the account when the app opens.
 */
function SocialComplete() {
  const search = useSearchParams();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = createClient();
        const { data, error: authError } = await db.auth.getUser();
        if (authError || !data.user) throw new Error("Your session has expired. Please sign in again.");
        const user = data.user;
        // Drops another account's cached state on this device before anything of this account is shown.
        setActiveUser(user.id);
        await Promise.allSettled([registerDevice(), claimPendingReferral()]);
        // Apple sends the name only on the first authorization; never blank or replace a chosen name.
        try {
          const { data: profile } = await db.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
          const name = socialDisplayName(profile?.display_name, user.email, user.user_metadata);
          if (name !== null) await db.from("profiles").update({ display_name: name }).eq("id", user.id);
        } catch {}
        if (!cancelled) window.location.replace(new URL(safeAuthNext(search.get("next")), window.location.origin).href);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Sign-in could not be completed. Please try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search]);
  return (
    <main className="authPage">
      <div className="authCard">
        <h1>{error ? "Sign-in needs attention" : "Signing you in…"}</h1>
        <p className="authIntro" role={error ? "alert" : "status"}>
          {error || "Securing your account and preparing your planner."}
        </p>
        {error && (
          <a className="button authSubmit" href="/login">
            Return to sign in
          </a>
        )}
      </div>
    </main>
  );
}

export default function SocialCompletePage() {
  return (
    <Suspense fallback={<main className="authPage" />}>
      <SocialComplete />
    </Suspense>
  );
}
