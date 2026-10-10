import { Flame, Sparkles } from "lucide-react";
import { MINUTES_PER_ITEM, type WeeklyValue } from "@/lib/weekly-value";

/** "This week with Zest" (lib/weekly-value.ts): dates captured, reminders sent, things done, time saved and streak. */
export default function WeeklyValueCard({ value }: { value: WeeklyValue }) {
  const stats = [
    { n: value.captured, label: value.captured === 1 ? "date captured" : "dates captured" },
    { n: value.remindersSent, label: value.remindersSent === 1 ? "reminder sent" : "reminders sent" },
    { n: value.completed, label: "done" },
  ];
  return (
    <section className="weeklyValue" aria-labelledby="weekly-value-title">
      <div className="weeklyValueHead">
        <h2 id="weekly-value-title">
          <Sparkles size={16} aria-hidden="true" /> This week with Zest
        </h2>
        {value.streak >= 2 && (
          <span className="weeklyStreak" title="Days in a row you've used Zest">
            <Flame size={14} aria-hidden="true" /> {value.streak}-day streak
          </span>
        )}
      </div>
      <div className="weeklyValueStats">
        {stats.map((s) => (
          <div key={s.label}>
            <b>{s.n}</b>
            <small>{s.label}</small>
          </div>
        ))}
      </div>
      {value.minutesSaved > 0 && (
        <p className="weeklyValueSaved">
          <b>≈ {value.minutesSaved} min saved</b>
          <small>Estimated at {MINUTES_PER_ITEM} min for each date you didn’t have to type.</small>
        </p>
      )}
    </section>
  );
}
