"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeAuthNext } from "@/lib/auth";
import { claimPendingReferral, registerDevice, setActiveUser } from "@/lib/session";

export default function SocialCompletePage() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function finish() {
      try {
        const { data, error: authError } = await createClient().auth.getUser();
        if (authError || !data.user) throw new Error("We could not verify your sign-in. Please try again.");
        setActiveUser(data.user.id);
        await Promise.allSettled([registerDevice(), claimPendingReferral()]);
        if (!cancelled) router.replace(safeAuthNext(search.get("next")));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Sign-in could not be completed.");
      }
    }
    void finish();
    return () => { cancelled = true; };
  }, [router, search]);
  return (
    <main className="authPage">
      <div className="authCard">
        <h1>{error ? "Sign-in needs attention" : "Welcome to Zest Snap"}</h1>
        <p className="authIntro" role="status">{error || "Securing your account and preparing your planner…"}</p>
        {error && <a className="button authSubmit" href="/login">Return to sign in</a>}
      </div>
    </main>
  );
}
