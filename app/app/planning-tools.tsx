"use client";

import { useMemo, useState } from "react";
import { CalendarRange, ChefHat, GraduationCap, Plus, Sparkles, X } from "lucide-react";
import { mealPlannerItem, timetablePlannerItems, type TimetableClassInput } from "@/lib/planning-expansion";
import { sharedPlannerStore } from "@/lib/planner-store";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Props = {
  identity: string;
  timezone: string;
  signedIn: boolean;
  onNotice?: (kind: "success" | "error", message: string) => void;
};

const isoToday = () => new Date().toISOString().slice(0, 10);
const plusDays = (date: string, days: number) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function PlanningTools({ identity, timezone, signedIn, onNotice }: Props) {
  const [open, setOpen] = useState<"timetable" | "meals" | null>(null);
  const [busy, setBusy] = useState(false);
  const [termStart, setTermStart] = useState(isoToday());
  const [termEnd, setTermEnd] = useState(plusDays(isoToday(), 70));
  const [scheduleTitle, setScheduleTitle] = useState("My timetable");
  const [classes, setClasses] = useState<TimetableClassInput[]>([
    { subject: "", weekdays: [1], startTime: "08:00", endTime: "09:00", location: "" },
  ]);
  const [mealDate, setMealDate] = useState(isoToday());
  const [mealTitle, setMealTitle] = useState("");
  const [mealTime, setMealTime] = useState("18:30");
  const [mealType, setMealType] = useState<"breakfast" | "lunch" | "dinner" | "snack" | "other">("dinner");

  const classCount = useMemo(() => classes.filter((x) => x.subject.trim()).length, [classes]);
  const notify = (k: "success" | "error", m: string) => onNotice?.(k, m);

  async function saveTimetable() {
    if (busy) return;
    setBusy(true);
    try {
      const valid = classes.filter((x) => x.subject.trim());
      const items = timetablePlannerItems({ title: scheduleTitle, termStart, termEnd, timezone, classes: valid });
      if (items.length > 400) throw new Error("This timetable creates too many events. Shorten the term or reduce repeating days.");
      const store = await sharedPlannerStore(identity);
      for (const item of items) await store.upsert(item);
      if (signedIn && isSupabaseConfigured()) {
        const db = createClient();
        const { data: auth } = await db.auth.getUser();
        const userId = auth.user?.id;
        if (userId) {
          const { data: schedule, error } = await db.from("timetable_schedules").insert({
            user_id: userId, title: scheduleTitle.trim(), term_start: termStart, term_end: termEnd, timezone,
          }).select("id").single();
          if (error) throw error;
          const rows = valid.map((c) => ({
            schedule_id: schedule.id, user_id: userId, subject: c.subject.trim(), weekdays: c.weekdays,
            start_time: c.startTime, end_time: c.endTime, location: c.location?.trim() || null,
          }));
          const saved = await db.from("timetable_classes").insert(rows);
          if (saved.error) throw saved.error;
        }
      }
      notify("success", `${items.length} recurring classes added to Planner.`);
      setOpen(null);
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Timetable could not be saved.");
    } finally { setBusy(false); }
  }

  async function saveMeal() {
    if (busy) return;
    setBusy(true);
    try {
      const item = mealPlannerItem({ title: mealTitle, mealDate, mealType, startTime: mealTime }, timezone);
      const store = await sharedPlannerStore(identity);
      await store.upsert(item);
      if (signedIn && isSupabaseConfigured()) {
        const db = createClient();
        const { data: auth } = await db.auth.getUser();
        const userId = auth.user?.id;
        if (userId) {
          const week = new Date(mealDate + "T12:00:00Z");
          const day = week.getUTCDay() || 7;
          week.setUTCDate(week.getUTCDate() - day + 1);
          const weekStart = week.toISOString().slice(0, 10);
          const { data: plan, error } = await db.from("meal_plans").upsert(
            { user_id: userId, week_start: weekStart, title: "Weekly meals" },
            { onConflict: "user_id,week_start" },
          ).select("id").single();
          if (error) throw error;
          const saved = await db.from("meal_entries").insert({
            plan_id: plan.id, user_id: userId, meal_date: mealDate, meal_type: mealType,
            title: mealTitle.trim(), start_time: mealTime || null,
          });
          if (saved.error) throw saved.error;
        }
      }
      notify("success", "Meal added to Planner.");
      setMealTitle("");
      setOpen(null);
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Meal could not be saved.");
    } finally { setBusy(false); }
  }

  return (
    <div className="planningTools">
      <div className="planningToolsHeader">
        <div><Sparkles /><div><b>Plan more with Zest</b><span>Timetables and meals become part of the same Planner.</span></div></div>
      </div>
      <div className="planningToolCards">
        <button type="button" onClick={() => setOpen("timetable")}><GraduationCap /><span><b>Timetable</b><small>Create recurring classes</small></span></button>
        <button type="button" onClick={() => setOpen("meals")}><ChefHat /><span><b>Meals</b><small>Plan meals into your week</small></span></button>
      </div>
      {open === "timetable" && (
        <div className="planningToolSheet" role="dialog" aria-modal="true" aria-label="Create timetable">
          <div className="planningToolSheetHead"><div><GraduationCap /><b>Create timetable</b></div><button onClick={() => setOpen(null)} aria-label="Close"><X /></button></div>
          <label>Name<input value={scheduleTitle} onChange={(e) => setScheduleTitle(e.target.value)} maxLength={120} /></label>
          <div className="planningToolGrid"><label>Term starts<input type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} /></label><label>Term ends<input type="date" value={termEnd} onChange={(e) => setTermEnd(e.target.value)} /></label></div>
          {classes.map((c, i) => <div className="planningClass" key={i}>
            <input aria-label="Subject" placeholder="Subject" value={c.subject} onChange={(e) => setClasses(v => v.map((x,n)=>n===i?{...x,subject:e.target.value}:x))} />
            <div className="planningToolGrid"><input aria-label="Start time" type="time" value={c.startTime} onChange={(e)=>setClasses(v=>v.map((x,n)=>n===i?{...x,startTime:e.target.value}:x))}/><input aria-label="End time" type="time" value={c.endTime} onChange={(e)=>setClasses(v=>v.map((x,n)=>n===i?{...x,endTime:e.target.value}:x))}/></div>
            <div className="weekdayPicker">{["M","T","W","T","F","S","S"].map((d,n)=><button type="button" key={n} className={c.weekdays.includes(n+1)?"active":""} onClick={()=>setClasses(v=>v.map((x,j)=>j===i?{...x,weekdays:x.weekdays.includes(n+1)?x.weekdays.filter(q=>q!==n+1):[...x.weekdays,n+1]}:x))}>{d}</button>)}</div>
          </div>)}
          <button className="planningAddRow" type="button" onClick={()=>setClasses(v=>[...v,{subject:"",weekdays:[1],startTime:"08:00",endTime:"09:00",location:""}])}><Plus /> Add class</button>
          <button className="primaryButton" disabled={busy || !classCount} onClick={saveTimetable}>{busy ? "Adding…" : "Add recurring classes"}</button>
        </div>
      )}
      {open === "meals" && (
        <div className="planningToolSheet" role="dialog" aria-modal="true" aria-label="Plan a meal">
          <div className="planningToolSheetHead"><div><ChefHat /><b>Plan a meal</b></div><button onClick={() => setOpen(null)} aria-label="Close"><X /></button></div>
          <label>Meal<input placeholder="What are you having?" value={mealTitle} onChange={(e)=>setMealTitle(e.target.value)} maxLength={160}/></label>
          <div className="planningToolGrid"><label>Date<input type="date" value={mealDate} onChange={(e)=>setMealDate(e.target.value)}/></label><label>Time<input type="time" value={mealTime} onChange={(e)=>setMealTime(e.target.value)}/></label></div>
          <label>Type<select value={mealType} onChange={(e)=>setMealType(e.target.value as typeof mealType)}><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snack</option><option value="other">Other</option></select></label>
          <button className="primaryButton" disabled={busy || !mealTitle.trim()} onClick={saveMeal}>{busy ? "Adding…" : "Add meal to Planner"}</button>
        </div>
      )}
    </div>
  );
}
