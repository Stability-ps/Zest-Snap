"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Bell, CalendarDays, Check, CheckCircle2 } from "lucide-react";
import { INTEREST_IDS, saveIntro, type InterestId } from "@/lib/intro";
import "./intro.css";

const INTERESTS: Record<InterestId, { emoji: string; label: string; hint: string }> = {
  school: { emoji: "🏫", label: "School & kids", hint: "Notices, newsletters" },
  health: { emoji: "🩺", label: "Health", hint: "Doctor, dentist" },
  work: { emoji: "💼", label: "Work", hint: "Meetings, deadlines" },
  bills: { emoji: "🧾", label: "Bills & renewals", hint: "Licences, payments" },
  events: { emoji: "🎟️", label: "Events", hint: "Invites, tickets" },
  travel: { emoji: "✈️", label: "Travel", hint: "Flights, bookings" },
};

const STEPS = 3;

function isNativeShell() {
  return typeof window !== "undefined" && Boolean((window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

/**
 * One-time intro for a brand-new device (see lib/intro.ts for who sees it). Three short screens: what Zest
 * does (an animated photo-to-plan demo), what the person wants to remember, and reminders. Every exit
 * (Get started, Skip, Sign in) records it as seen so it never shows again on this device.
 */
export default function Intro() {
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<InterestId[]>([]);
  const [native, setNative] = useState(false);
  const [busy, setBusy] = useState(false);
  // Photo-to-plan demo on the first screen: "idle" → "scan" → "done" (chips appear), then it loops.
  // Driven from here with plain CSS transitions; looping CSS keyframe animations froze on some iPhones.
  const [phase, setPhase] = useState<"idle" | "scan" | "done">("idle");

  useEffect(() => {
    setNative(isNativeShell());
    // Dark screen: light status-bar icons and a navy browser chrome while the intro is open.
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", "#0B1F3B"));
    void import("@/lib/appearance/client").then(({ applyNativeAppearance }) => applyNativeAppearance("dark")).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (step !== 0) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPhase("done");
      return;
    }
    const timers: number[] = [];
    const cycle = () => {
      setPhase("idle");
      timers.push(window.setTimeout(() => setPhase("scan"), 500));
      timers.push(window.setTimeout(() => setPhase("done"), 2500));
      timers.push(window.setTimeout(cycle, 7000));
    };
    cycle();
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [step]);

  const leave = (to: string) => {
    saveIntro(picked);
    // A full load so the app starts with its normal appearance and status bar.
    window.location.assign(to);
  };

  const tap = () => void import("@/lib/native/haptics").then((h) => h.hapticLight()).catch(() => undefined);

  const toggle = (id: InterestId) => {
    tap();
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const enableReminders = async () => {
    setBusy(true);
    try {
      const { enableNativeNotifications } = await import("@/lib/native/notifications");
      await enableNativeNotifications();
    } catch {
      // Declined or unavailable: reminders can be turned on later in Settings.
    }
    leave("/app");
  };

  return (
    <main className="introPage">
      <header className="introTop">
        <button
          type="button"
          className="introIconBtn"
          aria-label="Back"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          style={{ visibility: step ? "visible" : "hidden" }}
        >
          <ArrowLeft size={22} />
        </button>
        <div className="introProgress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step + 1} aria-label={`Step ${step + 1} of ${STEPS}`}>
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={i <= step ? "on" : ""} />
          ))}
        </div>
        <button type="button" className="introSkip" onClick={() => leave("/app")}>
          Skip
        </button>
      </header>

      {step === 0 && (
        <section className="introStep" key="s0">
          <div className="introStage" data-phase={phase} aria-hidden="true">
            <div className="introGlow" />
            <div className="introPaper">
              <span className="introCorner tl" />
              <span className="introCorner tr" />
              <span className="introCorner bl" />
              <span className="introCorner br" />
              <small>RIVERSIDE PRIMARY</small>
              <b>Science Fair</b>
              <p>Thursday 23 October</p>
              <p>09:00 · School hall</p>
              <p className="faint">Please bring your project board</p>
              <span className="introScanLine" />
            </div>
            <div className="introChips">
              <div className="introChip teal">
                <CalendarDays size={18} />
                <span>
                  <b>Science Fair</b>
                  <small>Thu 23 Oct · 09:00</small>
                </span>
              </div>
              <div className="introChip amber">
                <Bell size={18} />
                <span>
                  <b>Reminder</b>
                  <small>Wed 22 Oct · 18:00</small>
                </span>
              </div>
              <div className="introChip violet">
                <CheckCircle2 size={18} />
                <span>
                  <b>Bring project board</b>
                  <small>To-do</small>
                </span>
              </div>
            </div>
          </div>
          <div className="introCopy">
            <h1>
              Snap it. Zest <em>remembers</em> it.
            </h1>
            <p>Photos, screenshots and PDFs become events, reminders and to-dos in seconds.</p>
          </div>
          <div className="introActions">
            <button type="button" className="introPrimary" onClick={() => setStep(1)}>
              Get started <ArrowRight size={20} />
            </button>
            <button type="button" className="introLink" onClick={() => leave("/login")}>
              Already have an account? <b>Sign in</b>
            </button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="introStep" key="s1">
          <div className="introCopy top">
            <h1>
              What do you want to <em>remember</em>?
            </h1>
            <p>Pick any that fit. Zest works with anything that has a date.</p>
          </div>
          <div className="introGrid">
            {INTEREST_IDS.map((id) => {
              const on = picked.includes(id);
              const it = INTERESTS[id];
              return (
                <button key={id} type="button" className={"introOption" + (on ? " on" : "")} aria-pressed={on} onClick={() => toggle(id)}>
                  <span className="introEmoji" aria-hidden="true">
                    {it.emoji}
                  </span>
                  <b>{it.label}</b>
                  <small>{it.hint}</small>
                  <span className="introTick" aria-hidden="true">
                    <Check size={14} strokeWidth={3} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="introActions">
            <button type="button" className="introPrimary" onClick={() => setStep(2)}>
              Continue <ArrowRight size={20} />
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="introStep" key="s2">
          <div className="introStage notices" aria-hidden="true">
            <div className="introGlow amber" />
            <div className="introNotice n1">
              <span className="introAppIcon" />
              <span>
                <b>Science Fair tomorrow</b>
                <small>09:00 · School hall · bring the project board</small>
              </span>
              <time>now</time>
            </div>
            <div className="introNotice n2">
              <span className="introAppIcon" />
              <span>
                <b>Dentist in 1 hour</b>
                <small>Dr Naidoo · 14:30</small>
              </span>
              <time>1h</time>
            </div>
            <div className="introNotice n3">
              <span className="introAppIcon" />
              <span>
                <b>Car licence renews Friday</b>
                <small>Pay online before 31 Oct</small>
              </span>
              <time>2d</time>
            </div>
          </div>
          <div className="introCopy">
            <h1>
              Never miss the <em>important</em> dates.
            </h1>
            <p>Zest reminds you before it matters, only about things you saved.</p>
          </div>
          <div className="introActions">
            {native ? (
              <>
                <button type="button" className="introPrimary" disabled={busy} onClick={enableReminders}>
                  <Bell size={20} /> Turn on reminders
                </button>
                <button type="button" className="introLink" onClick={() => leave("/app")}>
                  Not now
                </button>
              </>
            ) : (
              <button type="button" className="introPrimary" onClick={() => leave("/app")}>
                Start snapping <ArrowRight size={20} />
              </button>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
