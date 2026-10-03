"use client";
import { useState } from "react";
import {
  Globe2,
  CalendarDays,
  Bell,
  Sparkles,
  ArrowRight,
  Check,
} from "lucide-react";

const steps = [
  {
    icon: Globe2,
    title: "Your locale",
    text: "Zest Snap uses your language, date format and timezone to reduce ambiguity.",
  },
  {
    icon: CalendarDays,
    title: "Your calendar",
    text: "Choose where approved events should go. You can connect more calendars later.",
  },
  {
    icon: Bell,
    title: "Useful reminders",
    text: "Get reminders for events and deadlines you choose, without noisy engagement notifications.",
  },
  {
    icon: Sparkles,
    title: "Your first reward",
    text: "Complete your first successful scan to unlock your first Zest Credits.",
  },
];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const Icon = current.icon;
  const done = step === steps.length - 1;
  return (
    <main className="onboardingPage">
      <div className="onboardingCard">
        <div className="brand">
          Zest <span>Snap</span>
        </div>
        <div className="onboardingProgress">
          {steps.map((_, i) => (
            <span key={i} className={i <= step ? "done" : ""} />
          ))}
        </div>
        <div className="onboardingIcon">
          <Icon />
        </div>
        <div className="eyebrow">
          STEP {step + 1} OF {steps.length}
        </div>
        <h1>{current.title}</h1>
        <p>{current.text}</p>
        {step === 0 && (
          <div className="settingPreview">
            <div>
              <span>Detected language</span>
              <b>
                {typeof navigator !== "undefined"
                  ? navigator.language
                  : "English"}
              </b>
            </div>
            <div>
              <span>Detected timezone</span>
              <b>
                {typeof Intl !== "undefined"
                  ? Intl.DateTimeFormat().resolvedOptions().timeZone
                  : "UTC"}
              </b>
            </div>
          </div>
        )}
        {step === 1 && (
          <div className="choiceStack">
            <button>
              <CalendarDays />
              <span>
                <b>Google Calendar</b>
                <small>Connect after account setup</small>
              </span>
            </button>
            <button>
              <CalendarDays />
              <span>
                <b>Apple Calendar</b>
                <small>Use secure calendar export</small>
              </span>
            </button>
            <button>
              <CalendarDays />
              <span>
                <b>Microsoft Outlook</b>
                <small>Connect after account setup</small>
              </span>
            </button>
          </div>
        )}
        {step === 2 && (
          <div className="choiceStack">
            <button className="selected">
              <Check />
              <span>
                <b>Smart reminders</b>
                <small>Only about things you asked Zest Snap to track</small>
              </span>
            </button>
            <button>
              <Bell />
              <span>
                <b>Weekly recap</b>
                <small>A useful summary of what is ahead</small>
              </span>
            </button>
          </div>
        )}
        {step === 3 && (
          <div className="rewardWelcome">
            <Sparkles />
            <b>+3 Zest Credits</b>
            <span>available after your first successful scan</span>
          </div>
        )}
        <div className="onboardingActions">
          {step > 0 && (
            <button className="button alt" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {done ? (
            <a href="/app" className="button">
              Start snapping <ArrowRight size={17} />
            </a>
          ) : (
            <button className="button" onClick={() => setStep(step + 1)}>
              Continue <ArrowRight size={17} />
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
