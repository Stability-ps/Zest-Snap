"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Upload,
  CalendarDays,
  Gift,
  Clock,
  Home as HomeIcon,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  MapPin,
  Sparkles,
  Download,
  ChevronRight,
  FileText,
  Pencil,
  Trash2,
  Check,
  History as HistoryIcon,
  Settings as SettingsIcon,
  MoreVertical,
  Search,
  MessageSquare,
  Star,
  X,
} from "lucide-react";
import type { ExtractionResult, ExtractedEvent } from "@/lib/extraction-types";

type View = "home" | "review" | "history" | "calendar" | "rewards";

import {
  getDataProvider,
  migrateLocal,
  emptyState,
  type DataProvider,
  type StoredScan,
  type StoredEvent,
  type LocalState,
} from "@/lib/data";
import { eventFingerprint, validateEvent, agendaGroup } from "@/lib/events";
import { generateIcs } from "@/lib/ics";
import PlannerView from "./planner-view";
import { PlannerStore } from "@/lib/planner-store";
import { createClient } from "@/lib/supabase/client";
import { extractionToPlannerSuggestion } from "@/lib/planner-from-extraction";
import { plannerReferenceDate, todayDate, type PlannerItem } from "@/lib/planner";

export default function App() {
  const provider = useRef<DataProvider | null>(null);
  const [ready, setReady] = useState(false);
  const [insights, setInsights] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [startupCredits, setStartupCredits] = useState<number | null>(null);
  const [mode, setMode] = useState("local");
  const [activeScan, setActiveScan] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>("home");
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanStage, setScanStage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [store, setStore] = useState<LocalState>(emptyState);
  const [homePlannerItems, setHomePlannerItems] = useState<PlannerItem[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<ExtractedEvent | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [plannerInitialTab, setPlannerInitialTab] = useState<"today" | "upcoming">("today");
  const [installed, setInstalled] = useState(false);
  const [plannerVisited, setPlannerVisited] = useState(false);

  const STARTUP_STATE_KEY = "zest-last-app-state-v1";

  function deviceId() {
    const key="zest-device-id";
    let id=localStorage.getItem(key);
    if(!id){id=crypto.randomUUID()+"-"+crypto.randomUUID();localStorage.setItem(key,id);}
    return id;
  }

  function openView(next: View) {
    if (next === "calendar") setPlannerVisited(true);
    setView(next);
    const url = new URL(window.location.href);
    if (next === "home" || next === "review") url.searchParams.delete("view");
    else url.searchParams.set("view", next === "calendar" ? "planner" : next);
    window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
  }

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;
    setInstalled(standalone);
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const appInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", appInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", appInstalled);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (view !== "home") return;
    PlannerStore.create()
      .then(async (planner) => {
        const cached = planner.loadCached();
        if (!cancelled && cached.length) setHomePlannerItems(cached);
        const items = await planner.load();
        if (!cancelled) setHomePlannerItems(items);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [view]);

  const homeTodayPlanner = useMemo(
    () =>
      homePlannerItems.filter(
        (item) =>
          item.status !== "cancelled" &&
          plannerReferenceDate(item) === todayDate(item.timezone || "UTC"),
      ),
    [homePlannerItems],
  );
  const homeTodayEvents = useMemo(() => {
    const seen = new Set(
      homeTodayPlanner.map(
        (item) =>
          `${item.title.trim().toLowerCase()}|${plannerReferenceDate(item)}|${item.startTime || item.dueTime || ""}`,
      ),
    );
    const legacy = store.events.filter((event) => {
      if (agendaGroup(event) !== "Today") return false;
      const key = `${event.title.trim().toLowerCase()}|${event.startDate}|${event.startTime || ""}`;
      return !seen.has(key);
    });
    return [
      ...homeTodayPlanner.map((item) => ({
        id: item.id,
        title: item.title,
        startTime: item.startTime || item.dueTime || "",
        location: item.location,
        allDay: item.allDay,
      })),
      ...legacy.map((event) => ({
        id: event.id,
        title: event.title,
        startTime: event.startTime || "",
        location: event.location,
        allDay: event.allDay,
      })),
    ].sort((a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99"));
  }, [homeTodayPlanner, store.events]);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice?.outcome === "accepted") setInstallPrompt(null);
  }

  useEffect(() => {
    const lastName = localStorage.getItem("zest-last-display-name")?.trim();
    if (lastName) setDisplayName(lastName);
    try {
      const raw = localStorage.getItem(STARTUP_STATE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { credits?: number; displayName?: string; mode?: string; state?: LocalState };
        const credits = typeof cached.credits === "number" ? cached.credits : cached.state?.credits;
        if (typeof credits === "number") setStartupCredits(credits);
        if (cached.displayName?.trim()) setDisplayName(cached.displayName.trim());
        if (cached.mode) setMode(cached.mode);
        if (cached.state) {
          localStorage.setItem(STARTUP_STATE_KEY, JSON.stringify({
            credits: cached.state.credits,
            displayName: cached.displayName || lastName || "",
            mode: cached.mode || "local",
          }));
        }
      }
      const planner = PlannerStore.loadLastUsed();
      if (planner.length) setHomePlannerItems(planner);
    } catch {
      localStorage.removeItem(STARTUP_STATE_KEY);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    getDataProvider()
      .then(async (p) => {
        const cached = p.loadCached?.();
        const cachedProfile = p.loadCachedProfile?.();
        if (mounted && cachedProfile?.displayName) {
          setDisplayName(cachedProfile.displayName.trim());
        }
        if (mounted && cached) {
          provider.current = p;
          setStore(cached);
          setMode(p.mode);
          setReady(true);
        }
        let data;
        if (p.mode === "cloud") {
          data = await migrateLocal(p);
          try {
            const response = await fetch("/api/account/migrate-local", {
              method: "POST",
              headers: { "X-Zest-Action": "migrate-local" },
            });
            if (response.ok) data = await p.load();
          } catch {
            // Scans and planner data are already migrated; reward sync can retry later.
          }
        } else {
          data = await p.load();
        }
        const pref = await p.loadProfile();
        if (mounted) {
          const nextName = pref.displayName.trim();
          setDisplayName(nextName);
          if (nextName) localStorage.setItem("zest-last-display-name", nextName);
        }
        if (pref.retentionDays > 0) {
          const next = {
            ...data,
            scans: data.scans.filter(
              (s) =>
                Date.parse(s.scannedAt) >
                Date.now() - pref.retentionDays * 86400000,
            ),
          };
          if (next.scans.length !== data.scans.length) {
            await p.save(next, data);
            data = next;
          }
        }
        if (mounted) {
          setInsights(pref.reminders);
          provider.current = p;
          setStore(data);
          setMode(p.mode);
          setReady(true);
          try {
            localStorage.setItem(STARTUP_STATE_KEY, JSON.stringify({ credits: data.credits, displayName: pref.displayName.trim(), mode: p.mode }));
            setStartupCredits(data.credits);
          } catch {}
        }
      })
      .catch(() =>
        setError(
          "Could not load saved data. Check your connection and reload.",
        ),
      );
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view");
    if (requestedView === "calendar" || requestedView === "planner") { setView("calendar"); setPlannerVisited(true); }
    if (requestedView === "rewards") setView("rewards");
    if (requestedView === "history") setView("history");
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (editingIndex !== null) dialogRef.current?.showModal();
  }, [editingIndex]);
  useEffect(() => {
    const sync = () => {
      if (provider.current?.mode === "cloud")
        provider.current
          .load()
          .then(setStore)
          .catch(() =>
            setError(
              "Cloud changes are saved on this device and waiting to sync. Reconnect and reload to retry.",
            ),
          );
    };
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, []);
  async function persist(next: LocalState) {
    if (!provider.current) throw new Error("Storage is not ready.");
    await provider.current.save(next, store);
    if (provider.current.mode === "cloud") next = await provider.current.load();
    setStore(next);
    try {
      localStorage.setItem(STARTUP_STATE_KEY, JSON.stringify({ credits: next.credits, displayName, mode: provider.current.mode }));
      setStartupCredits(next.credits);
    } catch {}
  }

  const highConfidence = useMemo(
    () => result?.events.filter((e) => e.confidence >= 0.8).length ?? 0,
    [result],
  );

  const sortedAgenda = useMemo(
    () =>
      [...store.events].sort((a, b) => {
        const ak = a.startDate + "T" + (a.startTime || "00:00");
        const bk = b.startDate + "T" + (b.startTime || "00:00");
        return ak.localeCompare(bk);
      }),
    [store.events],
  );

  async function scanFile(file?: File) {
    if (!file || !ready || busy) return;
    if (!navigator.onLine) {
      setError(
        "Scanning needs internet. Your saved history and agenda remain available.",
      );
      return;
    }
    setError("");
    setSuccess("");

    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      setError("Zest Snap currently accepts images and PDFs.");
      return;
    }
    if (isPdf && file.size > 3_000_000) {
      setError(
        "This PDF is too large to scan right now. Please use a PDF smaller than 3 MB.",
      );
      return;
    }
    if (isImage && file.size > 15_000_000) {
      setError(
        "This photo is too large to scan. Please choose a smaller image.",
      );
      return;
    }

    setBusy(true);
    setScanStage(isPdf ? "Preparing your PDF..." : "Preparing your photo...");
    try {
      const prepared = await prepareFileForScan(file);
      if (prepared.dataUrl.length > 4_000_100)
        throw new Error(
          "This file is still too large after compression. Try a smaller image or PDF.",
        );
      setScanStage("Finding dates and times...");
      const preferences = await provider.current!.loadProfile();
      const timezone = preferences.timezone;
      const locale = preferences.locale;
      const requestId = crypto.randomUUID();
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
          "X-Zest-Device": deviceId(),
        },
        signal: AbortSignal.timeout(65000),
        body: JSON.stringify({
          dataUrl: prepared.dataUrl,
          mimeType: prepared.mimeType,
          fileName: file.name,
          timezone,
          locale,
        }),
      });

      setScanStage("Organising your events...");
      const raw = await res.text();
      let payload: ExtractionResult | { error?: string } | null = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }

      if (!res.ok) {
        if (res.status === 413)
          throw new Error(
            "This file is too large to scan. Try a smaller PDF or photo.",
          );
        throw new Error(
          (payload && "error" in payload && payload.error) ||
            "We could not scan this file right now. Please try again.",
        );
      }
      if (
        !payload ||
        !("events" in payload) ||
        !Array.isArray(payload.events)
      ) {
        throw new Error(
          "The scan finished, but the result could not be read. Please try again.",
        );
      }

      const scan: StoredScan = {
        id: requestId,
        fileName: friendlySourceName(file),
        scannedAt: new Date().toISOString(),
        documentType: payload.documentType,
        summary: payload.summary,
        events: payload.events,
        warnings: payload.warnings,
      };

      await persist({
        ...store,
        scans: [scan, ...store.scans],
      });

      setActiveScan(scan.id);
      setResult(payload);
      setSelected(payload.events.map((_: ExtractedEvent, i: number) => i));
      setView("review");
      // Cloud reward balances are authoritative and refreshed by persist().
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
    setSelected((s) =>
      s.includes(index) ? s.filter((i) => i !== index) : [...s, index],
    );
  }

  function duplicateOf(event: ExtractedEvent) {
    const key = eventKey(event);
    return store.events.some((e) => eventKey(e) === key);
  }

  function beginEdit(index: number) {
    if (!result) return;
    setEditingIndex(index);
    setDraft({ ...result.events[index] });
  }

  async function saveEdit() {
    if (!result || editingIndex === null || !draft) return;
    try {
      validateEvent(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check event details.");
      return;
    }
    const events = [...result.events];
    events[editingIndex] = draft;
    try {
      await persist({
        ...store,
        scans: store.scans.map((s) =>
          s.id === activeScan ? { ...s, events } : s,
        ),
      });
    } catch {
      setError("Could not save changes. Try again.");
      return;
    }
    setResult({ ...result, events });
    setEditingIndex(null);
    setDraft(null);
  }

  async function saveSelectedToPlanner(indexes: number[]) {
    if (!result || !activeScan || !indexes.length) return;
    setBusy(true); setError("");
    try {
      const planner = await PlannerStore.create();
      let saved = 0;
      for (const index of indexes) {
        const event = result.events[index];
        if (!event) continue;
        await planner.upsert(extractionToPlannerSuggestion(event, activeScan).item);
        saved++;
      }
      setSuccess(saved === 1 ? "Saved to Planner." : `${saved} items saved to Planner.`);
      setPlannerInitialTab("upcoming");
      setView("calendar");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save to Planner."); }
    finally { setBusy(false); }
  }

  async function downloadIcs(events: ExtractedEvent | ExtractedEvent[]) {
    const items = Array.isArray(events) ? events : [events];
    if (!items.length) return;

    const newItems = [
      ...new Map(
        items
          .filter((e) => !duplicateOf(e))
          .map((e) => [eventFingerprint(e), e]),
      ).values(),
    ];
    const duplicateCount = items.length - newItems.length;
    if (!newItems.length) {
      setSuccess("These events are already in your Zest agenda.");
      return;
    }

    setError("");
    try {
      let blob: Blob;
      if (mode === "cloud") {
        const res = await fetch("/api/calendar/ics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: newItems }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error("Calendar export failed");
        blob = await res.blob();
      } else
        blob = new Blob([await generateIcs(newItems)], {
          type: "text/calendar;charset=utf-8",
        });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download =
        newItems.length > 1 ? "zest-snap-events.ics" : "zest-snap-event.ics";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);

      const now = new Date().toISOString();
      const added = newItems.map((event) => ({
        ...event,
        id: crypto.randomUUID(),
        addedAt: now,
        exportedAt: now,
      }));
      const calendarReward = !store.firstCalendarRewarded ? 1 : 0;
      await persist({
        ...store,
        events: [...store.events, ...added],
        credits: store.credits + calendarReward,
        firstCalendarRewarded: true,
      });

      const parts = [
        newItems.length === 1
          ? "1 event prepared for your calendar."
          : `${newItems.length} events prepared for your calendar.`,
      ];
      if (duplicateCount)
        parts.push(
          `${duplicateCount} duplicate ${duplicateCount === 1 ? "was" : "were"} skipped.`,
        );
      if (calendarReward && mode === "local")
        parts.push("You earned 1 Zest Credit.");
      setSuccess(parts.join(" "));
    } catch {
      setError(
        "Check dates, start/end times and timezone, then retry. Ambiguous clock-change times need correction.",
      );
    }
  }

  async function addPlannerItem(event: ExtractedEvent) {
    try {
      validateEvent(event);
      const reward = !store.firstCalendarRewarded ? 1 : 0;
      await persist({ ...store, events: [...store.events, { ...event, id: crypto.randomUUID(), addedAt: new Date().toISOString() }], credits: store.credits + reward, firstCalendarRewarded: true });
      setPlannerOpen(false);
      setSuccess(reward ? "Added to Planner - you earned 1 Zest Credit." : "Added to Planner.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add this item."); }
  }

  async function removeAgendaEvent(id: string) {
    try {
      await persist({
        ...store,
        events: store.events.filter((e) => e.id !== id),
      });
      setSuccess("Removed from Zest. External calendars are unchanged.");
    } catch {
      setError("Could not remove event. Try again.");
    }
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <div className="brand">
          Zest <span>Snap</span>
        </div>
        <div className="appHeaderActions">
          <button className="creditPill" onClick={() => setView("rewards")}>
            <Sparkles size={14} /> {ready ? store.credits : startupCredits ?? "—"} credits
          </button>
          <a className="settingsIconButton" href="/settings" aria-label="Settings">
            <SettingsIcon aria-hidden="true" />
          </a>
        </div>
      </header>

      <div className="appContent">
        {error && (
          <div className="errorBox" role="alert">
            {error}
          </div>
        )}
        {view === "home" && (
          <>
            {!installed && installPrompt && (
              <button className="button alt" onClick={installApp}>
                Install Zest Snap
              </button>
            )}
            <section className="appIntro homeHero">
              <div className="homeGreeting">Good morning{displayName ? `, ${displayName.split(" ")[0]}` : ""} <span aria-hidden="true">👋</span></div>
              <h1>What do you want to remember?</h1>
              <p>Snap or upload it. Zest finds the important dates.</p>
            </section>

            <section className="captureCard captureCardHome">
              <div className="captureMark zestCaptureMark"><Camera /></div>
              <h2>Capture something with a date</h2>
              <p>Appointments, notices, bookings, schedules and PDFs.</p>
              <div className="captureActions">
                <button className="button" onClick={() => cameraRef.current?.click()} disabled={busy || !ready}>
                  {busy ? <Loader2 className="spin" size={20} /> : <Camera size={20} />} Take photo
                </button>
                <button className="button alt" onClick={() => fileRef.current?.click()} disabled={busy || !ready}>
                  <Upload size={20} /> Upload
                </button>
              </div>
              <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(e: ChangeEvent<HTMLInputElement>) => scanFile(e.target.files?.[0])}/>
              <input ref={fileRef} hidden type="file" accept="image/*,application/pdf" onChange={(e: ChangeEvent<HTMLInputElement>) => scanFile(e.target.files?.[0])}/>
              {busy && <div className="scanStatus"><Loader2 className="spin" size={17}/>{scanStage || "Reading your file..."}</div>}
              {error && <div className="errorBox"><AlertTriangle size={16}/>{error}</div>}
              {success && <div className="successBox"><CheckCircle2 size={16}/>{success}</div>}
            </section>

            <section className="homeToday">
              <div className="homeTodayHead">
                <div className="homeTodayTitle"><span><CalendarDays/></span><div><h2>Today</h2><p>{homeTodayEvents.length} things in your day</p></div></div>
                <button className="homeViewAll" onClick={()=>openView("calendar")}>View all <ChevronRight size={17}/></button>
              </div>
              <div className="homeTimeline">
                {homeTodayEvents.slice(0,3).map((event,i)=><button key={event.id} className={"homeTimelineItem tone"+(i%3)} onClick={()=>openView("calendar")}>
                  <span className="homeTimelineTime">{event.startTime || "All day"}</span>
                  <span className="homeTimelineDot"/>
                  <span className="homeTimelineBody"><b>{event.title}</b><small>{event.location || (event.startTime ? "Today" : "All day")}</small></span>
                  <ChevronRight size={18}/>
                </button>)}
                {!homeTodayEvents.length&&<button className="homeTodayEmpty" onClick={()=>openView("calendar")}><span>Your day is clear.</span><b>Open Planner <ChevronRight size={16}/></b></button>}
              </div>
            </section>
          </>
        )}

        {view === "review" && result && (
          <>
            <section className="reviewTop">
              <button className="textButton" onClick={() => setView("home")}>
                ← Scan another
              </button>
              <div className="eyebrow">AI REVIEW</div>
              <h1>
                {result.events.length === 0
                  ? "No actionable dates found"
                  : `${result.events.length} ${result.events.length === 1 ? "event" : "events"} found`}
              </h1>
              <p>{result.summary}</p>
              <div className="reviewStats">
                <span>
                  <CheckCircle2 size={15} />
                  {highConfidence} high confidence
                </span>
                <span>
                  <FileText size={15} />
                  {result.documentType}
                </span>
              </div>
            </section>

            {success && (
              <div className="successBox standalone">
                <CheckCircle2 size={18} />
                {success}
              </div>
            )}
            {result.warnings.map((w, i) => (
              <div className="warningBox" key={i}>
                <AlertTriangle size={18} />
                <div>
                  <b>Please check this</b>
                  <p>{w}</p>
                </div>
              </div>
            ))}

            <p>
              <button
                className="textButton"
                onClick={() => setSelected(result.events.map((_, i) => i))}
              >
                Select all
              </button>{" "}
              ·{" "}
              <button className="textButton" onClick={() => setSelected([])}>
                Clear selection
              </button>
            </p>
            <div className="eventList">
              {result.events.map((event, i) => {
                const checked = selected.includes(i);
                const duplicate = duplicateOf(event);
                return (
                  <article
                    className={
                      "reviewEvent " +
                      (checked ? "selected " : "") +
                      (duplicate ? "duplicate" : "")
                    }
                    key={i}
                  >
                    <button
                      className="selectCircle"
                      onClick={() => toggle(i)}
                      aria-label={"Select " + event.title}
                      aria-pressed={checked}
                    >
                      {checked ? "✓" : ""}
                    </button>
                    <div className="eventBody">
                      <div className="eventHeading">
                        <div>
                          <span className="category">{event.category}</span>
                          <h3>{event.title}</h3>
                        </div>
                        <span
                          className={
                            "confidence " +
                            (event.confidence < 0.7 ? "low" : "")
                          }
                        >
                          {Math.round(event.confidence * 100)}%
                        </span>
                      </div>
                      <div className="eventMeta">
                        <span>
                          <CalendarDays size={16} />
                          {event.startDate || "Date needs review"}
                          {event.startTime ? " · " + event.startTime : ""}
                        </span>
                        {event.location && (
                          <span>
                            <MapPin size={16} />
                            {event.location}
                          </span>
                        )}
                      </div>
                      {event.confidenceReason && (
                        <p className="reason">{event.confidenceReason}</p>
                      )}
                      {duplicate && (
                        <div className="duplicateNote">
                          <Check size={14} />
                          Already in your Zest agenda
                        </div>
                      )}
                      <div className="eventButtons">
                        <button
                          className="button alt small"
                          onClick={() => beginEdit(i)}
                        >
                          <Pencil size={15} /> Edit
                        </button>
                        <button
                          className="button alt small"
                          onClick={() => downloadIcs(event)}
                          disabled={duplicate}
                        >
                          <Download size={16} />
                          {duplicate ? "Added" : "Add to device calendar"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="stickyAction">
              <div>
                <b>{selected.length} selected</b>
                <span>Duplicates are skipped automatically</span>
              </div>
              <div className="stickyActions">
                <button
                  className="button alt"
                  disabled={!selected.length}
                  onClick={() => downloadIcs(selected.map((i) => result!.events[i]).filter(Boolean))}
                >
                  <Download size={16} /> Calendar
                </button>
                <button
                  className="button"
                  disabled={!selected.length}
                  onClick={() => saveSelectedToPlanner(selected)}
                >
                  Save to Planner
                </button>
              </div>
            </div>
          </>
        )}

        {view === "history" && (
          <HistoryView
            scans={store.scans}
            onOpen={(s) => {
              setActiveScan(s.id);
              setResult({ ...s, warnings: s.warnings || [] });
              setSelected(s.events.map((_, i) => i));
              setView("review");
            }}
            onDelete={async (id) => {
              try {
                await persist({
                  ...store,
                  scans: store.scans.filter((s) => s.id !== id),
                });
              } catch {
                setError("Could not delete scan. Try again.");
              }
            }}
          />
        )}
        {(view === "calendar" || plannerVisited) && (
          <div hidden={view !== "calendar"} aria-hidden={view !== "calendar"}>
            <PlannerView
              initialTab={plannerInitialTab}
              onNotice={(kind, message) => kind === "success" ? setSuccess(message) : setError(message)}
            />
          </div>
        )}
        {view === "rewards" && <RewardsView ready={ready} store={store} onPlan={() => { setView("calendar"); setPlannerOpen(true); }} onFeedback={async(rating,feedback)=>{try{if(mode!=="cloud"){window.location.href="/login?next=/app?view=rewards";return false;}const db=createClient();const {data,error}=await db.rpc("submit_product_feedback",{p_rating:rating,p_feedback:feedback});if(error)throw error;const fresh=await provider.current?.load();if(fresh)setStore(fresh);setSuccess(Number(data)>0?`Thanks for the feedback — +${data} Zest Credits.`:"Thanks — your feedback was already received.");return true;}catch{setError("We couldn’t submit your feedback right now.");return false;}}} onInvite={async () => { try { const code = await provider.current?.createReferral(); if (!code) { window.location.href = "/login?next=/app?view=rewards"; return; } const url = `${window.location.origin}/?ref=${encodeURIComponent(code)}`; if (navigator.share) await navigator.share({ title: "Zest Snap", text: "Turn photos and documents into plans with Zest Snap.", url }); else { await navigator.clipboard.writeText(url); setSuccess("Referral link copied."); } } catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; setError("We couldn’t open sharing right now. Please try again."); } }} />}

        {plannerOpen && <PlannerSheet onClose={() => setPlannerOpen(false)} onSave={addPlannerItem} />}

        {editingIndex !== null && draft && (
          <dialog
            ref={dialogRef}
            className="modalBackdrop"
            onCancel={() => {
              setEditingIndex(null);
              setDraft(null);
            }}
          >
            <div className="editSheet" onClick={(e) => e.stopPropagation()}>
              <div className="sheetHandle" />
              <div className="sheetTop">
                <div>
                  <div className="eyebrow">REVIEW EVENT</div>
                  <h2>Edit before adding</h2>
                </div>
                <button
                  aria-label="Close editor"
                  className="iconButton"
                  onClick={() => {
                    setEditingIndex(null);
                    setDraft(null);
                  }}
                >
                  ×
                </button>
              </div>
              <label>
                <span>Title</span>
                <input
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
              </label>
              <div className="fieldGrid">
                <label>
                  <span>Date</span>
                  <input
                    type="date"
                    value={draft.startDate}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        startDate: e.target.value,
                        endDate: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  <span>Time</span>
                  <input
                    type="time"
                    value={draft.startTime}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        startTime: e.target.value,
                        allDay: !e.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <div className="fieldGrid">
                <label>
                  <span>End date</span>
                  <input
                    type="date"
                    value={draft.endDate}
                    onChange={(e) =>
                      setDraft({ ...draft, endDate: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>End time</span>
                  <input
                    type="time"
                    value={draft.endTime}
                    onChange={(e) =>
                      setDraft({ ...draft, endTime: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                <span>All day</span>
                <input
                  type="checkbox"
                  checked={draft.allDay}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      allDay: e.target.checked,
                      startTime: e.target.checked ? "" : draft.startTime,
                      endTime: e.target.checked ? "" : draft.endTime,
                    })
                  }
                />
              </label>
              <label>
                <span>Timezone</span>
                <input
                  value={draft.timezone}
                  onChange={(e) =>
                    setDraft({ ...draft, timezone: e.target.value })
                  }
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <label>
                <span>Location</span>
                <input
                  value={draft.location}
                  onChange={(e) =>
                    setDraft({ ...draft, location: e.target.value })
                  }
                />
              </label>
              <label>
                <span>Notes</span>
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </label>
              <button className="button sheetSave" onClick={saveEdit}>
                <Check size={17} /> Save changes
              </button>
            </div>
          </dialog>
        )}
      </div>

      <nav className="bottomNav">
        <NavButton
          active={view === "home" || view === "review"}
          label="Home"
          onClick={() => openView("home")}
          icon={<HomeIcon />}
        />
        <NavButton
          active={view === "calendar"}
          label="Planner"
          onClick={() => openView("calendar")}
          icon={<CalendarDays />}
        />
        <NavButton
          active={view === "history"}
          label="History"
          onClick={() => openView("history")}
          icon={<Clock />}
        />
        <NavButton
          active={view === "rewards"}
          label="Rewards"
          onClick={() => openView("rewards")}
          icon={<Gift />}
        />
      </nav>
    </main>
  );
}

function NavButton({
  active,
  label,
  onClick,
  icon,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button type="button" className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <small>{label}</small>
    </button>
  );
}

function HistoryView({
  scans,
  onOpen,
  onDelete,
}: {
  scans: StoredScan[];
  onOpen: (s: StoredScan) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const [menuId, setMenuId] = useState<string | null>(null);
  const filtered = scans.filter((scan) => {
    const q = query.trim().toLowerCase();
    return !q || scan.fileName.toLowerCase().includes(q) || scan.summary.toLowerCase().includes(q);
  });
  const visible = filtered.slice(0, visibleCount);
  if (!scans.length)
    return (
      <EmptyView
        title="Scan history"
        text="Your successful scans will appear here automatically."
        icon={<HistoryIcon />}
      />
    );
  return (
    <section className="dataView historyView">
      <div className="historyHeading">
        <div><h1>Your scan history</h1><p>{scans.length} saved {scans.length === 1 ? "scan" : "scans"} · everything you’ve captured in Zest</p></div>
      </div>
      <label className="historySearch">
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setVisibleCount(20); }}
          placeholder="Search scan history"
          aria-label="Search scan history"
        />
      </label>
      <div className="historyList">
        {visible.map((scan) => (
          <article className="historyCard compact" key={scan.id}>
            <div className="historyIcon"><FileText /></div>
            <button className="historyMain" onClick={() => onOpen(scan)}>
              <div className="historyTop">
                <b>{scan.fileName}</b>
                <span>{new Date(scan.scannedAt).toLocaleDateString()}</span>
              </div>
              <p>{scan.summary}</p>
              <small>
                {scan.events.length} {scan.events.length === 1 ? "event" : "events"} · {scan.warnings?.length || 0} warnings
              </small>
            </button>
            <div className="historyMenu">
              <button className="iconButton" aria-label={"More options for " + scan.fileName} onClick={() => setMenuId(menuId === scan.id ? null : scan.id)}>
                <MoreVertical />
              </button>
              {menuId === scan.id && (
                <div className="historyMenuPopup">
                  <button onClick={() => { setMenuId(null); onOpen(scan); }}>Review</button>
                  <button className="dangerText" onClick={() => { setMenuId(null); onDelete(scan.id); }}>Delete</button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      {!filtered.length && <div className="historyNoResults">No scans match “{query}”.</div>}
      {visibleCount < filtered.length && (
        <button className="button alt historyLoadMore" onClick={() => setVisibleCount((n) => n + 20)}>
          Load 20 more
        </button>
      )}
    </section>
  );
}

function AgendaView({ events, onDelete, onAdd }: { events: StoredEvent[]; onDelete: (id: string) => void; onAdd: () => void }) {
  const [tab, setTab] = useState<"today" | "upcoming" | "calendar" | "reminders">("today");
  const today = new Date().toISOString().slice(0, 10);
  const reminderLike = (event: StoredEvent) => event.sourceText === "Manual Planner item" && /remind/i.test(event.description + " " + event.title);
  const visible = events.filter(event => {
    if (tab === "today") return event.startDate === today;
    if (tab === "upcoming") return event.startDate >= today;
    if (tab === "reminders") return reminderLike(event);
    return event.startDate >= today;
  });
  const monthLabel = new Date().toLocaleDateString(undefined,{month:"long",year:"numeric"});
  return (
    <section className="dataView plannerView">
      <div className="plannerHeading"><div><div className="eyebrow">PLANNER</div><h1>Your planner</h1></div><button className="plannerPlus" onClick={onAdd} aria-label="Add to Planner">+</button></div>
      <p>Events, tasks and reminders from your scans and the things you add yourself.</p>
      <div className="plannerTabs">
        {(["today","upcoming","calendar","reminders"] as const).map(x => <button key={x} className={tab===x?"active":""} onClick={()=>setTab(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}
      </div>
      {tab === "today" && <div className="plannerSummary"><b>{visible.length ? visible.length + " planned today" : "Your day is clear"}</b><span>{new Date().toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"})}</span></div>}
      {tab === "calendar" && <div className="monthStrip"><b>{monthLabel}</b><span>{visible.length} upcoming</span></div>}
      {!visible.length ? <div className="plannerEmpty"><CalendarDays/><b>{tab === "reminders" ? "No reminders yet" : tab === "today" ? "Nothing planned for today" : "Nothing here yet"}</b><span>Tap + to add an event, task or reminder.</span><button className="button alt" onClick={onAdd}>Add to Planner</button></div> :
      <div className="agendaList">{visible.map(event => <article className="agendaCard" key={event.id}>
        <div className="agendaDate"><b>{event.startDate.slice(8,10)}</b><span>{monthName(event.startDate)}</span></div>
        <div className="agendaBody"><div className="agendaTop"><span className="category">{event.category === "deadline" ? "task" : reminderLike(event) ? "reminder" : event.category}</span><em>{agendaGroup(event)}</em></div><h3>{event.title}</h3><p>{event.startTime || "All day"}{event.location ? " · "+event.location : ""}</p></div>
        <button className="iconButton danger" onClick={()=>onDelete(event.id)} aria-label={"Remove "+event.title+" from Planner"}><Trash2/></button>
      </article>)}</div>}
    </section>
  );
}

function EmptyView({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="emptyView">
      <div className="emptyIcon">{icon}</div>
      <h1>{title}</h1>
      <p>{text}</p>
    </section>
  );
}

function PlannerSheet({ onClose, onSave }: { onClose: () => void; onSave: (event: ExtractedEvent) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<"event" | "task" | "reminder">("event");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const submit = () => {
    if (!title.trim() || !date) return;
    onSave({ title: title.trim(), startDate: date, endDate: date, startTime: time, endTime: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", location: "", description: notes, allDay: !time, confidence: 1, confidenceReason: "Added manually", sourceText: "Manual Planner item", category: kind === "task" ? "deadline" : "event" });
  };
  return <div className="plannerOverlay" role="presentation" onClick={onClose}>
    <section className="plannerSheet" role="dialog" aria-modal="true" aria-label="Add to Planner" onClick={e => e.stopPropagation()}>
      <div className="sheetHandle" /><div className="sheetTop"><div><div className="eyebrow">NEW PLAN</div><h2>Add to Planner</h2></div><button className="iconButton" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="plannerKinds">{(["event","task","reminder"] as const).map(x => <button key={x} className={kind === x ? "active" : ""} onClick={() => setKind(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</div>
      <label><span>Title</span><input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder={kind === "task" ? "What needs to be done?" : kind === "reminder" ? "What should Zest remind you about?" : "What's happening?"} /></label>
      <div className="fieldGrid"><label><span>Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><label><span>Time (optional)</span><input type="time" value={time} onChange={e => setTime(e.target.value)} /></label></div>
      <label><span>Notes (optional)</span><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <button className="button sheetSave" disabled={!title.trim() || !date} onClick={submit}>Add to Planner</button>
    </section>
  </div>;
}

function RewardsView({ ready, store, onPlan, onInvite, onFeedback }: { ready: boolean; store: LocalState; onPlan: () => void; onInvite: () => void; onFeedback: (rating:number|null,feedback:string)=>Promise<boolean> }) {
  const [feedbackOpen,setFeedbackOpen]=useState(false);
  const [rating,setRating]=useState<number|null>(null);
  const [feedback,setFeedback]=useState("");
  const [sending,setSending]=useState(false);
  const submitFeedback=async()=>{if(sending)return;setSending(true);const ok=await onFeedback(rating,feedback);setSending(false);if(ok)setFeedbackOpen(false);};
  return (
    <section className="rewardsView">
      <h1>Your rewards</h1>
      <p>Earn small milestone credits, and earn more by helping Zest grow.</p>
      <div className="rewardBalance"><span>Current balance</span><b>{ready ? store.credits : "—"}</b><small>{ready ? "Zest Credits" : "Syncing…"}</small></div>
      <div className="rewardRows">
        <div className={"rewardItem " + (store.firstScanRewarded ? "completed" : "")}>
          <span className="rewardIcon"><CheckCircle2 /></span>
          <span className="rewardCopy"><b>Complete your first scan</b><small>{store.firstScanRewarded ? "Completed" : "Complete a scan · +1 credit"}</small></span>
          <span className="rewardState">{store.firstScanRewarded ? <Check size={18} /> : "+1"}</span>
        </div>
        {store.firstCalendarRewarded ? (
          <div className="rewardItem completed">
            <span className="rewardIcon"><CalendarDays /></span>
            <span className="rewardCopy"><b>Plan your first item</b><small>Completed</small></span>
            <span className="rewardState"><Check size={18} /></span>
          </div>
        ) : (
          <button className="rewardItem actionable" type="button" onClick={onPlan}>
            <span className="rewardIcon"><CalendarDays /></span>
            <span className="rewardCopy"><b>Plan your first item</b><small>Open Planner · +1 credit</small></span>
            <ChevronRight className="rewardChevron" size={18} />
          </button>
        )}
        <button className="rewardItem actionable" type="button" onClick={()=>setFeedbackOpen(true)}>
          <span className="rewardIcon"><MessageSquare /></span>
          <span className="rewardCopy"><b>Share your experience</b><small>Any honest feedback · +2 credits once</small></span>
          <ChevronRight className="rewardChevron" size={18} />
        </button>
        <button className="rewardItem actionable" type="button" onClick={onInvite}>
          <span className="rewardIcon"><Gift /></span>
          <span className="rewardCopy"><b>Invite a friend</b><small>Qualified referral · +5 credits</small></span>
          <ChevronRight className="rewardChevron" size={18} />
        </button>
      </div>
      {feedbackOpen&&<div className="plannerOverlay"><section className="plannerSheet compact feedbackSheet" role="dialog" aria-modal="true" aria-labelledby="feedback-title"><div className="sheetTop"><div><h2 id="feedback-title">Share your experience</h2><span className="sheetHint">Positive or negative — honest feedback earns the same reward.</span></div><button className="iconButton" onClick={()=>setFeedbackOpen(false)} aria-label="Close"><X/></button></div><div className="feedbackStars" aria-label="Optional rating">{[1,2,3,4,5].map(n=><button key={n} type="button" className={rating&&n<=rating?"active":""} aria-label={`${n} star${n===1?"":"s"}`} onClick={()=>setRating(n)}><Star/></button>)}</div><label><span>Tell us what you think (optional)</span><textarea rows={5} maxLength={2000} value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="What works well? What should we improve?"/></label><p className="feedbackPolicy">Credits are for submitting feedback, not for giving a positive rating.</p><button className="button sheetSave" disabled={sending} onClick={submitFeedback}>{sending?"Sending…":"Send feedback · +2 credits"}</button></section></div>}
    </section>
  );
}

function friendlySourceName(file: File) {
  if (file.type.startsWith("image/") && /^\d+\./.test(file.name))
    return "Camera photo";
  return (
    file.name || (file.type === "application/pdf" ? "PDF document" : "Photo")
  );
}

const eventKey = eventFingerprint;

function monthName(date: string) {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short" }).toUpperCase();
}

async function readAsDataUrl(file: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error || new Error("Could not read this file."));
    reader.readAsDataURL(file);
  });
}

async function prepareFileForScan(
  file: File,
): Promise<{ dataUrl: string; mimeType: string }> {
  if (!file.type.startsWith("image/") || file.size <= 2_000_000) {
    return { dataUrl: await readAsDataUrl(file), mimeType: file.type };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const maxDimension = 2000;
    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image compression is unavailable.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.82),
      mimeType: "image/jpeg",
    };
  } catch {
    if (file.size > 3_000_000)
      throw new Error(
        "This photo is too large to scan on this device. Please use a smaller photo.",
      );
    return { dataUrl: await readAsDataUrl(file), mimeType: file.type };
  }
}
