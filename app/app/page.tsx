"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, Upload, CalendarDays, Gift, Clock, Home as HomeIcon, CheckCircle2,
  AlertTriangle, Loader2, MapPin, Sparkles, Download, ChevronRight, FileText,
  Pencil, Trash2, Check, Bell, History as HistoryIcon
} from "lucide-react";
import type { ExtractionResult, ExtractedEvent } from "@/lib/extraction-types";

type View = "home" | "review" | "history" | "calendar" | "rewards";

type StoredScan = {
  id: string;
  fileName: string;
  scannedAt: string;
  documentType: string;
  summary: string;
  events: ExtractedEvent[];
};

type StoredEvent = ExtractedEvent & {
  id: string;
  addedAt: string;
};

type LocalState = {
  scans: StoredScan[];
  events: StoredEvent[];
  credits: number;
  firstScanRewarded: boolean;
  firstCalendarRewarded: boolean;
};

const STORAGE_KEY = "zest-snap-local-v2";
const emptyState: LocalState = {
  scans: [],
  events: [],
  credits: 0,
  firstScanRewarded: false,
  firstCalendarRewarded: false
};

export default function App() {
  const [view, setView] = useState<View>("home");
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanStage, setScanStage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [store, setStore] = useState<LocalState>(emptyState);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<ExtractedEvent | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setStore({ ...emptyState, ...JSON.parse(saved) });
    } catch {}
  }, []);

  function persist(next: LocalState) {
    setStore(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  }

  const highConfidence = useMemo(
    () => result?.events.filter(e => e.confidence >= .8).length ?? 0,
    [result]
  );

  const sortedAgenda = useMemo(() => [...store.events].sort((a,b) => {
    const ak = a.startDate + "T" + (a.startTime || "00:00");
    const bk = b.startDate + "T" + (b.startTime || "00:00");
    return ak.localeCompare(bk);
  }), [store.events]);

  async function scanFile(file?: File) {
    if (!file) return;
    setError("");
    setSuccess("");

    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      setError("Zest Snap currently accepts images and PDFs.");
      return;
    }
    if (isPdf && file.size > 3_000_000) {
      setError("This PDF is too large to scan right now. Please use a PDF smaller than 3 MB.");
      return;
    }
    if (isImage && file.size > 15_000_000) {
      setError("This photo is too large to scan. Please choose a smaller image.");
      return;
    }

    setBusy(true);
    setScanStage(isPdf ? "Preparing your PDF..." : "Preparing your photo...");
    try {
      const prepared = await prepareFileForScan(file);
      setScanStage("Finding dates and times...");
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const locale = navigator.language || "en";
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataUrl: prepared.dataUrl,
          mimeType: prepared.mimeType,
          fileName: file.name,
          timezone,
          locale
        })
      });

      setScanStage("Organising your events...");
      const raw = await res.text();
      let payload: ExtractionResult | { error?: string } | null = null;
      try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }

      if (!res.ok) {
        if (res.status === 413) throw new Error("This file is too large to scan. Try a smaller PDF or photo.");
        throw new Error((payload && "error" in payload && payload.error) || "We could not scan this file right now. Please try again.");
      }
      if (!payload || !("events" in payload) || !Array.isArray(payload.events)) {
        throw new Error("The scan finished, but the result could not be read. Please try again.");
      }

      const scan: StoredScan = {
        id: crypto.randomUUID(),
        fileName: friendlySourceName(file),
        scannedAt: new Date().toISOString(),
        documentType: payload.documentType,
        summary: payload.summary,
        events: payload.events
      };

      const firstReward = !store.firstScanRewarded ? 3 : 0;
      persist({
        ...store,
        scans: [scan, ...store.scans].slice(0, 50),
        credits: store.credits + firstReward,
        firstScanRewarded: true
      });

      setResult(payload);
      setSelected(payload.events.map((_: ExtractedEvent, i: number) => i));
      setView("review");
      if (firstReward) setSuccess("First scan complete - you earned 3 Zest Credits.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not scan this file.");
    } finally {
      setBusy(false);
      setScanStage("");
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function toggle(index: number) {
    setSelected(s => s.includes(index) ? s.filter(i => i !== index) : [...s, index]);
  }

  function duplicateOf(event: ExtractedEvent) {
    const key = eventKey(event);
    return store.events.some(e => eventKey(e) === key);
  }

  function beginEdit(index: number) {
    if (!result) return;
    setEditingIndex(index);
    setDraft({ ...result.events[index] });
  }

  function saveEdit() {
    if (!result || editingIndex === null || !draft) return;
    const events = [...result.events];
    events[editingIndex] = draft;
    setResult({ ...result, events });
    setEditingIndex(null);
    setDraft(null);
  }

  async function downloadIcs(events: ExtractedEvent | ExtractedEvent[]) {
    const items = Array.isArray(events) ? events : [events];
    if (!items.length) return;

    const newItems = items.filter(e => !duplicateOf(e));
    const duplicateCount = items.length - newItems.length;
    if (!newItems.length) {
      setSuccess("These events are already in your Zest agenda.");
      return;
    }

    setError("");
    try {
      const res = await fetch("/api/calendar/ics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: newItems })
      });
      if (!res.ok) throw new Error("Calendar export failed.");

      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = newItems.length > 1 ? "zest-snap-events.ics" : "zest-snap-event.ics";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);

      const now = new Date().toISOString();
      const added = newItems.map(event => ({ ...event, id: crypto.randomUUID(), addedAt: now }));
      const calendarReward = !store.firstCalendarRewarded ? 5 : 0;
      persist({
        ...store,
        events: [...store.events, ...added],
        credits: store.credits + calendarReward,
        firstCalendarRewarded: true
      });

      const parts = [newItems.length === 1 ? "1 event prepared for your calendar." : `${newItems.length} events prepared for your calendar.`];
      if (duplicateCount) parts.push(`${duplicateCount} duplicate ${duplicateCount === 1 ? "was" : "were"} skipped.`);
      if (calendarReward) parts.push("You earned 5 Zest Credits.");
      setSuccess(parts.join(" "));
    } catch {
      setError("We could not prepare these calendar events. Please try again.");
    }
  }

  function removeAgendaEvent(id: string) {
    persist({ ...store, events: store.events.filter(e => e.id !== id) });
  }

  return <main className="appShell">
    <header className="appHeader">
      <div className="brand">Zest <span>Snap</span></div>
      <button className="creditPill" onClick={() => setView("rewards")}><Sparkles size={14}/> {store.credits} credits</button>
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
          {busy && <div className="scanStatus"><Loader2 className="spin" size={17}/>{scanStage || "Reading your file..."}</div>}
          {error && <div className="errorBox"><AlertTriangle size={16}/>{error}</div>}
          {success && <div className="successBox"><CheckCircle2 size={16}/>{success}</div>}
        </section>

        <section className="quickGrid">
          <button className="miniCard" onClick={() => setView("calendar")}>
            <div className="miniIcon blue"><CalendarDays/></div><div><b>Upcoming</b><span>{store.events.length ? `${store.events.length} saved ${store.events.length === 1 ? "event" : "events"}` : "Your intelligent agenda"}</span></div><ChevronRight/>
          </button>
          <button className="miniCard" onClick={() => setView("rewards")}>
            <div className="miniIcon teal"><Gift/></div><div><b>Zest Rewards</b><span>{store.credits} credits earned</span></div><ChevronRight/>
          </button>
        </section>

        <section className="insightCard">
          <Sparkles size={18}/><div><b>Zest keeps working after the scan.</b><p>Your saved agenda, scan history and duplicate protection stay available on this device while the cloud account layer is being connected.</p></div>
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

        {success && <div className="successBox standalone"><CheckCircle2 size={18}/>{success}</div>}
        {result.warnings.map((w, i) => <div className="warningBox" key={i}><AlertTriangle size={18}/><div><b>Please check this</b><p>{w}</p></div></div>)}

        <div className="eventList">
          {result.events.map((event, i) => {
            const checked = selected.includes(i);
            const duplicate = duplicateOf(event);
            return <article className={"reviewEvent " + (checked ? "selected " : "") + (duplicate ? "duplicate" : "")} key={i}>
              <button className="selectCircle" onClick={() => toggle(i)} aria-label="Select event">{checked ? "✓" : ""}</button>
              <div className="eventBody">
                <div className="eventHeading"><div><span className="category">{event.category}</span><h3>{event.title}</h3></div><span className={"confidence " + (event.confidence < .7 ? "low" : "")}>{Math.round(event.confidence*100)}%</span></div>
                <div className="eventMeta"><span><CalendarDays size={16}/>{event.startDate || "Date needs review"}{event.startTime ? " · " + event.startTime : ""}</span>{event.location && <span><MapPin size={16}/>{event.location}</span>}</div>
                {event.confidenceReason && <p className="reason">{event.confidenceReason}</p>}
                {duplicate && <div className="duplicateNote"><Check size={14}/>Already in your Zest agenda</div>}
                <div className="eventButtons">
                  <button className="button alt small" onClick={() => beginEdit(i)}><Pencil size={15}/> Edit</button>
                  <button className="button alt small" onClick={() => downloadIcs(event)} disabled={duplicate}><Download size={16}/>{duplicate ? "Added" : "Add to calendar"}</button>
                </div>
              </div>
            </article>
          })}
        </div>

        <div className="stickyAction"><div><b>{selected.length} selected</b><span>Duplicates are skipped automatically</span></div><button className="button" disabled={!selected.length} onClick={() => downloadIcs(selected.map(i => result.events[i]))}>Add selected</button></div>
      </>}

      {view === "history" && <HistoryView scans={store.scans}/>}
      {view === "calendar" && <AgendaView events={sortedAgenda} onDelete={removeAgendaEvent}/>}
      {view === "rewards" && <RewardsView store={store}/>}

      {editingIndex !== null && draft && <div className="modalBackdrop" onClick={() => {setEditingIndex(null);setDraft(null);}}>
        <div className="editSheet" onClick={e => e.stopPropagation()}>
          <div className="sheetHandle"/>
          <div className="sheetTop"><div><div className="eyebrow">REVIEW EVENT</div><h2>Edit before adding</h2></div><button className="iconButton" onClick={() => {setEditingIndex(null);setDraft(null);}}>×</button></div>
          <label><span>Title</span><input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
          <div className="fieldGrid">
            <label><span>Date</span><input type="date" value={draft.startDate} onChange={e=>setDraft({...draft,startDate:e.target.value,endDate:e.target.value})}/></label>
            <label><span>Time</span><input type="time" value={draft.startTime} onChange={e=>setDraft({...draft,startTime:e.target.value,allDay:!e.target.value})}/></label>
          </div>
          <label><span>Location</span><input value={draft.location} onChange={e=>setDraft({...draft,location:e.target.value})}/></label>
          <label><span>Notes</span><textarea rows={3} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
          <button className="button sheetSave" onClick={saveEdit}><Check size={17}/> Save changes</button>
        </div>
      </div>}
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

function HistoryView({scans}:{scans:StoredScan[]}) {
  if (!scans.length) return <EmptyView title="Scan history" text="Your successful scans will appear here automatically." icon={<HistoryIcon/>}/>;
  return <section className="dataView">
    <div className="eyebrow">HISTORY</div><h1>Your scans</h1><p>Everything you scanned on this device, with the events Zest found.</p>
    <div className="historyList">{scans.map(scan=><article className="historyCard" key={scan.id}>
      <div className="historyIcon"><FileText/></div><div><div className="historyTop"><b>{scan.fileName}</b><span>{new Date(scan.scannedAt).toLocaleDateString()}</span></div>
      <p>{scan.summary}</p><small>{scan.events.length} {scan.events.length === 1 ? "event" : "events"} · {scan.documentType}</small></div>
    </article>)}</div>
  </section>;
}

function AgendaView({events,onDelete}:{events:StoredEvent[];onDelete:(id:string)=>void}) {
  if (!events.length) return <EmptyView title="Your agenda" text="Events you add from a scan will appear here automatically." icon={<CalendarDays/>}/>;
  return <section className="dataView">
    <div className="eyebrow">UPCOMING</div><h1>Your Zest agenda</h1><p>A clean view of the events you have already acted on.</p>
    <div className="agendaList">{events.map(event=>{
      const status = relativeLabel(event.startDate, event.startTime);
      return <article className="agendaCard" key={event.id}>
        <div className="agendaDate"><b>{event.startDate.slice(8,10)}</b><span>{monthName(event.startDate)}</span></div>
        <div className="agendaBody"><div className="agendaTop"><span className="category">{event.category}</span>{status && <em>{status}</em>}</div><h3>{event.title}</h3><p>{event.startTime || "All day"}{event.location ? " · " + event.location : ""}</p></div>
        <button className="iconButton danger" onClick={()=>onDelete(event.id)} aria-label="Remove from Zest agenda"><Trash2/></button>
      </article>;
    })}</div>
  </section>;
}

function EmptyView({title,text,icon}:{title:string;text:string;icon:React.ReactNode}) {
  return <section className="emptyView"><div className="emptyIcon">{icon}</div><h1>{title}</h1><p>{text}</p></section>;
}

function RewardsView({store}:{store:LocalState}) {
  return <section className="rewardsView">
    <div className="eyebrow">ZEST REWARDS</div><h1>Useful rewards, not gimmicks.</h1><p>Credits recognise useful actions and can later unlock bonus AI scans when account billing is connected.</p>
    <div className="rewardBalance"><span>Current balance</span><b>{store.credits}</b><small>Zest Credits</small></div>
    <div className="rewardRows">
      <div><CheckCircle2/><span><b>Complete your first scan</b><small>{store.firstScanRewarded ? "Completed · +3 credits" : "+3 credits"}</small></span>{store.firstScanRewarded && <Check size={18}/>}</div>
      <div><CalendarDays/><span><b>Add your first calendar event</b><small>{store.firstCalendarRewarded ? "Completed · +5 credits" : "+5 credits"}</small></span>{store.firstCalendarRewarded && <Check size={18}/>}</div>
      <div><Gift/><span><b>Invite a friend</b><small>Coming with cloud accounts</small></span></div>
    </div>
  </section>;
}

function friendlySourceName(file: File) {
  if (file.type.startsWith("image/") && /^\d+\./.test(file.name)) return "Camera photo";
  return file.name || (file.type === "application/pdf" ? "PDF document" : "Photo");
}

function eventKey(event: Pick<ExtractedEvent,"title"|"startDate"|"startTime">) {
  return [event.title.trim().toLowerCase(), event.startDate, event.startTime || ""].join("|");
}

function monthName(date: string) {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString(undefined,{month:"short"}).toUpperCase();
}

function relativeLabel(date: string, time: string) {
  if (!date) return "";
  const target = new Date(date + "T" + (time || "23:59") + ":00");
  const diff = target.getTime() - Date.now();
  const days = Math.ceil(diff / 86400000);
  if (diff < 0) return "Past";
  if (days <= 1) return "Today";
  if (days === 2) return "Tomorrow";
  if (days <= 8) return `In ${days - 1} days`;
  return "";
}

async function readAsDataUrl(file: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read this file."));
    reader.readAsDataURL(file);
  });
}

async function prepareFileForScan(file: File): Promise<{ dataUrl: string; mimeType: string }> {
  if (!file.type.startsWith("image/") || file.size <= 2_000_000) {
    return { dataUrl: await readAsDataUrl(file), mimeType: file.type };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const maxDimension = 2000;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image compression is unavailable.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.82), mimeType: "image/jpeg" };
  } catch {
    if (file.size > 3_000_000) throw new Error("This photo is too large to scan on this device. Please use a smaller photo.");
    return { dataUrl: await readAsDataUrl(file), mimeType: file.type };
  }
}
