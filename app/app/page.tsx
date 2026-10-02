"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import {
  Camera, Upload, CalendarDays, Gift, Clock, Home as HomeIcon, CheckCircle2,
  AlertTriangle, Loader2, MapPin, Sparkles, Download, ChevronRight, FileText
} from "lucide-react";
import type { ExtractionResult, ExtractedEvent } from "@/lib/extraction-types";

type View = "home" | "review" | "history" | "calendar" | "rewards";

export default function App() {
  const [view, setView] = useState<View>("home");
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const highConfidence = useMemo(
    () => result?.events.filter(e => e.confidence >= .8).length ?? 0,
    [result]
  );

  async function scanFile(file?: File) {
    if (!file) return;
    setError("");
    if (file.size > 5_500_000) {
      setError("Please choose a file smaller than 5 MB for now.");
      return;
    }
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      setError("Zest Snap currently accepts images and PDFs.");
      return;
    }

    setBusy(true);
    setFileName(file.name);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const locale = navigator.language || "en";
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, mimeType: file.type, fileName: file.name, timezone, locale })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Scan failed.");
      setResult(payload);
      setSelected(payload.events.map((_: ExtractedEvent, i: number) => i));
      setView("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not scan this file.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(index: number) {
    setSelected(s => s.includes(index) ? s.filter(i => i !== index) : [...s, index]);
  }

  async function downloadIcs(event: ExtractedEvent) {
    const res = await fetch("/api/calendar/ics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event)
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "zest-snap-event.ics";
    a.click();
    URL.revokeObjectURL(href);
  }

  return <main className="appShell">
    <header className="appHeader">
      <div className="brand">Zest <span>Snap</span></div>
      <div className="creditPill"><Sparkles size={14}/> 0 credits</div>
    </header>

    <div className="appContent">
      {view === "home" && <>
        <section className="appIntro">
          <div className="eyebrow">YOUR DAY</div>
          <h1>What do you want to remember?</h1>
          <p>Capture anything with a date. Zest Snap will find it, organise it and let you review it before it reaches your calendar.</p>
        </section>

        <section className="captureCard">
          <div className="captureMark"><Camera/></div>
          <h2>Snap something with a date</h2>
          <p>Appointments, notices, screenshots, travel bookings, invoices, schedules and PDFs.</p>
          <div className="captureActions">
            <button className="button" onClick={() => cameraRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="spin" size={18}/> : <Camera size={18}/>} Take photo
            </button>
            <button className="button alt" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={18}/> Upload
            </button>
          </div>
          <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(e:ChangeEvent<HTMLInputElement>) => scanFile(e.target.files?.[0])}/>
          <input ref={fileRef} hidden type="file" accept="image/*,application/pdf" onChange={(e:ChangeEvent<HTMLInputElement>) => scanFile(e.target.files?.[0])}/>
          {busy && <div className="scanStatus"><Loader2 className="spin" size={17}/> Reading {fileName || "your file"}…</div>}
          {error && <div className="errorBox"><AlertTriangle size={16}/>{error}</div>}
        </section>

        <section className="quickGrid">
          <button className="miniCard" onClick={() => setView("calendar")}>
            <div className="miniIcon blue"><CalendarDays/></div><div><b>Upcoming</b><span>Your intelligent agenda</span></div><ChevronRight/>
          </button>
          <button className="miniCard" onClick={() => setView("rewards")}>
            <div className="miniIcon teal"><Gift/></div><div><b>Zest Rewards</b><span>Earn useful bonus scans</span></div><ChevronRight/>
          </button>
        </section>

        <section className="insightCard">
          <Sparkles size={18}/><div><b>Zest will keep working after the scan.</b><p>Upcoming reminders, follow-ups and weekly recaps will give you a reason to return without noisy notifications.</p></div>
        </section>
      </>}

      {view === "review" && result && <>
        <section className="reviewTop">
          <button className="textButton" onClick={() => setView("home")}>← Scan another</button>
          <div className="eyebrow">AI REVIEW</div>
          <h1>{result.events.length} {result.events.length === 1 ? "event" : "events"} found</h1>
          <p>{result.summary}</p>
          <div className="reviewStats"><span><CheckCircle2 size={15}/>{highConfidence} high confidence</span><span><FileText size={15}/>{result.documentType}</span></div>
        </section>

        {result.warnings.map((w, i) => <div className="warningBox" key={i}><AlertTriangle size={18}/><div><b>Please check this</b><p>{w}</p></div></div>)}

        <div className="eventList">
          {result.events.map((event, i) => {
            const checked = selected.includes(i);
            return <article className={"reviewEvent " + (checked ? "selected" : "")} key={i}>
              <button className="selectCircle" onClick={() => toggle(i)} aria-label="Select event">{checked ? "✓" : ""}</button>
              <div className="eventBody">
                <div className="eventHeading"><div><span className="category">{event.category}</span><h3>{event.title}</h3></div><span className={"confidence " + (event.confidence < .7 ? "low" : "")}>{Math.round(event.confidence*100)}%</span></div>
                <div className="eventMeta"><span><CalendarDays size={16}/>{event.startDate || "Date needs review"}{event.startTime ? " · " + event.startTime : ""}</span>{event.location && <span><MapPin size={16}/>{event.location}</span>}</div>
                {event.confidenceReason && <p className="reason">{event.confidenceReason}</p>}
                <div className="eventButtons"><button className="button alt small" onClick={() => downloadIcs(event)}><Download size={16}/> Add to calendar</button></div>
              </div>
            </article>
          })}
        </div>

        <div className="stickyAction"><div><b>{selected.length} selected</b><span>Review before adding</span></div><button className="button" onClick={() => selected.length && downloadIcs(result.events[selected[0]])}>Add selected</button></div>
      </>}

      {view === "history" && <EmptyView title="Scan history" text="Your previous scans will live here once account storage is connected." icon={<Clock/>}/>}
      {view === "calendar" && <EmptyView title="Your agenda" text="Upcoming events, deadlines and smart follow-ups will appear here." icon={<CalendarDays/>}/>}
      {view === "rewards" && <RewardsView/>}
    </div>

    <nav className="bottomNav">
      <NavButton active={view==="home"||view==="review"} label="Home" onClick={()=>setView("home")} icon={<HomeIcon/>}/>
      <NavButton active={view==="history"} label="History" onClick={()=>setView("history")} icon={<Clock/>}/>
      <NavButton active={view==="calendar"} label="Calendar" onClick={()=>setView("calendar")} icon={<CalendarDays/>}/>
      <NavButton active={view==="rewards"} label="Rewards" onClick={()=>setView("rewards")} icon={<Gift/>}/>
    </nav>
  </main>;
}

function NavButton({active,label,onClick,icon}:{active:boolean;label:string;onClick:()=>void;icon:React.ReactNode}) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}<small>{label}</small></button>;
}

function EmptyView({title,text,icon}:{title:string;text:string;icon:React.ReactNode}) {
  return <section className="emptyView"><div className="emptyIcon">{icon}</div><h1>{title}</h1><p>{text}</p></section>;
}

function RewardsView() {
  return <section className="rewardsView">
    <div className="eyebrow">ZEST REWARDS</div><h1>Useful rewards, not gimmicks.</h1><p>Earn credits through meaningful use. Credits can become bonus AI scans and selected premium perks.</p>
    <div className="rewardBalance"><span>Current balance</span><b>0</b><small>Zest Credits</small></div>
    <div className="rewardRows">
      <div><CheckCircle2/><span><b>Complete your first scan</b><small>+3 credits</small></span></div>
      <div><CalendarDays/><span><b>Connect a calendar</b><small>+5 credits</small></span></div>
      <div><Gift/><span><b>Invite a friend</b><small>Both earn bonus scans</small></span></div>
    </div>
  </section>;
}
