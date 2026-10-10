"use client";

import { ChangeEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Upload,
  CalendarDays,
  Gift,
  Home as HomeIcon,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  MapPin,
  Sparkles,
  Download,
  ChevronLeft,
  ChevronRight,
  FileText,
  Pencil,
  Check,
  History as HistoryIcon,
  Settings as SettingsIcon,
  MoreVertical,
  Search,
  MessageSquare,
  Star,
  X,
  Bell,
  ListChecks,
  Layers,
  UsersRound,
  Mic,
  Square,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { ExtractionResult, ExtractedEvent } from "@/lib/extraction-types";
import {
  getDataProvider,
  verifyAccount,
  hasGuestData,
  migrateGuestData,
  LocalDataProvider,
  emptyState,
  type DataProvider,
  type StoredScan,
  type LocalState,
} from "@/lib/data";
import { eventFingerprint, validateEvent } from "@/lib/events";
import { googleCalendarUrl } from "@/lib/google-calendar";
import { isNative } from "@/lib/native/runtime";
import { hasNativeSpeech, startNativeSpeech, stopNativeSpeech } from "@/lib/native/speech";
import { blockedPermissionHelp } from "@/lib/native/permissions";
import { CaptureCancelled, capturePhoto, nativeCameraAvailable } from "@/lib/native/camera";
import { addExtractedEventToDevice, deviceCalendarAvailable } from "@/lib/native/calendar";
import { hapticSuccess } from "@/lib/native/haptics";
import { shareTextNatively } from "@/lib/native/share";
import PlannerView, { type PlannerRequest } from "./planner-view";
import SharedView from "./shared-view";
import { PlannerStore, sharedPlannerStore, subscribePlanner } from "@/lib/planner-store";
import { createClient } from "@/lib/supabase/client";
import { extractionToPlannerSuggestion } from "@/lib/planner-from-extraction";
import { saveEventsToPlanner, saveSummary, withStartTime, type SaveOutcome } from "@/lib/save-to-planner";
import { normalizeDocumentType } from "@/lib/extraction-validation";
import { MAX_DATE, MIN_DATE, formatDisplayDate, formatDisplayTime, isValidDate } from "@/lib/dates";
import { monthGrid, plannerFingerprint, plannerReferenceDate, plannerReferenceTime, plannerTodayItems, plannerSort, plannerStatus, todayDate, mergePlannerWithExternal, type PlannerItem } from "@/lib/planner";
import {
  STARTUP_STATE_KEY,
  activeUser,
  captureReferral,
  claimPendingReferral,
  clearAccountCaches,
  deviceId,
  registerDevice,
  sessionUserIdSync,
  setActiveUser,
} from "@/lib/session";
import { syncPushSubscription } from "@/lib/reminders";
import { knownGuestTrialRemaining, rememberGuestTrial, trackConversion } from "@/lib/conversion";
import { materializeWeeklySchedule, weeklyOccurrences } from "@/lib/schedule";
import { readLocalInterests, snapExamples } from "@/lib/interests";
import type { InterestId } from "@/lib/intro";

type View = "home" | "review" | "history" | "calendar" | "todo" | "rewards" | "shared";
type Snapshot = { userId?: string; credits?: number; displayName?: string; mode?: string };
const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const REFRESH_INTERVAL = 30_000;

function viewFromUrl(search: string): { view: View; tab?: PlannerRequest["tab"] } {
  const q = new URLSearchParams(search);
  const v = q.get("view");
  const tab = q.get("tab");
  if (v === "calendar" || v === "planner")
    return { view: "calendar", tab: tab === "reminders" || tab === "upcoming" || tab === "calendar" || tab === "today" ? tab : undefined };
  if (v === "rewards" || v === "history" || v === "todo" || v === "shared") return { view: v };
  return { view: "home" };
}
function greeting(timezone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date()));
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default function App() {
  const provider = useRef<DataProvider | null>(null);
  const [ready, setReady] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [startupCredits, setStartupCredits] = useState<number | null>(null);
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [identity, setIdentity] = useState<string | null>(null);
  // Starts as UTC on both server and client (static prerender); the real zone is applied after mount.
  const [timezone, setTimezone] = useState("UTC");
  const [locale, setLocale] = useState("en");
  const [activeScan, setActiveScan] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>("home");
  // What the person wants to remember (intro / Settings › What you snap): tailors the Home examples.
  const [interests, setInterests] = useState<InterestId[]>([]);
  useEffect(() => {
    const read = () => setInterests(readLocalInterests().list);
    read();
    window.addEventListener("zest-interests-changed", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("zest-interests-changed", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  // Result of the last Save to Planner on the review screen; cleared when the selection or an event changes.
  const [saveOutcome, setSaveOutcome] = useState<SaveOutcome | null>(null);
  const [savingToPlanner, setSavingToPlanner] = useState(false);
  const savingRef = useRef(false);
  // One stable Planner id per review event, so a retry or repeated tap updates the same item instead of inserting again.
  const reviewItemIds = useRef(new Map<number, string>());
  const [scanStage, setScanStage] = useState("");
  const [error, setError] = useState("");
  const [errorAction, setErrorAction] = useState<"signup" | "plans" | null>(null);
  const [success, setSuccess] = useState("");
  const [store, setStore] = useState<LocalState>(emptyState);
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [googleCalendarItems, setGoogleCalendarItems] = useState<PlannerItem[]>([]);
  const [rules, setRules] = useState<Record<string, number>>({});
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<ExtractedEvent | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [plannerVisited, setPlannerVisited] = useState(false);
  const [plannerRequest, setPlannerRequest] = useState<PlannerRequest>({ nonce: 0 });
  const [plannerTab, setPlannerTab] = useState<string>();
  const lastRefresh = useRef(0);
  const router = useRouter();
  // The static HTML can't know who is signed in, so the greeting stays invisible until identity is known.
  const [greetingReady, setGreetingReady] = useState(false);
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const voiceRecognition = useRef<any>(null);

  const showError = useCallback((message: string, action: "signup" | "plans" | null = null) => {
    setError(message);
    setErrorAction(action);
  }, [setError, setErrorAction]);

  /**
   * Marketing notifications: records an open (?mc=<send id>) once, and on devices that opted in keeps the device
   * linked to this account and routes taps on app notifications inside the app. Never prompts.
   */
  function startMarketing(userId: string) {
    const recordOpen = (url: string) => {
      const sendId = new URL(url, window.location.origin).searchParams.get("mc");
      if (sendId && /^[0-9a-f-]{36}$/i.test(sendId))
        createClient().rpc("record_marketing_open" as never, { p_send: sendId } as never).then(() => undefined, () => undefined);
    };
    recordOpen(window.location.href);
    if (new URLSearchParams(window.location.search).has("mc")) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("mc");
      window.history.replaceState(window.history.state, "", clean.pathname + clean.search + clean.hash);
    }
    import("@/lib/marketing/push")
      .then((m) => {
        if (!m.marketingPushOnThisDevice(userId)) return;
        return m.resumeMarketingPush(userId, (path) => {
          recordOpen(path);
          const target = new URL(path, window.location.origin);
          target.searchParams.delete("mc");
          window.dispatchEvent(new CustomEvent("zest-open", { detail: { url: target.pathname + target.search } }));
        });
      })
      .catch(() => undefined);
  }

  function saveSnapshot(next: Snapshot) {
    try {
      localStorage.setItem(STARTUP_STATE_KEY, JSON.stringify(next));
    } catch {}
  }

  /** Single navigation path for every view change, including all ways into Planner. */
  const openView = useCallback(
    (next: View, opts: { tab?: PlannerRequest["tab"]; replace?: boolean; reminderAction?: "snooze" | "done"; reminderId?: string } = {}) => {
      if (next === "calendar") {
        setPlannerVisited(true);
        if (opts.tab || opts.reminderAction) setPlannerRequest((r) => ({ nonce: r.nonce + 1, tab: opts.tab, reminderAction: opts.reminderAction, reminderId: opts.reminderId }));
      }
      setView(next);
      const url = new URL(window.location.href);
      ["view", "tab", "reminderAction", "reminderId", "capture"].forEach((k) => url.searchParams.delete(k));
      if (next !== "home" && next !== "review") url.searchParams.set("view", next === "calendar" ? "planner" : next);
      if (next === "calendar" && opts.tab === "reminders") url.searchParams.set("tab", "reminders");
      const target = url.pathname + url.search;
      // History entries make the Android back button return to the previous view instead of closing the app.
      if (opts.replace || target === window.location.pathname + window.location.search) window.history.replaceState({ view: next }, "", target);
      else window.history.pushState({ view: next }, "", target);
      window.scrollTo({ top: 0 });
    },
    [],
  );

  // Back/forward buttons.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (e.state?.view === "review") return setView("review");
      const { view: next, tab } = viewFromUrl(window.location.search);
      if (next === "calendar") {
        setPlannerVisited(true);
        if (tab) setPlannerRequest((r) => ({ nonce: r.nonce + 1, tab }));
      }
      setView(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Deep links (notifications, manifest shortcuts) and messages from the service worker.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const { view: initial, tab } = viewFromUrl(window.location.search);
    const action = q.get("reminderAction");
    const reminderId = q.get("reminderId") || undefined;
    if (initial !== "home" || action)
      openView(initial === "home" ? "calendar" : initial, {
        tab: action ? "reminders" : tab,
        replace: true,
        reminderAction: action === "snooze" || action === "done" ? action : undefined,
        reminderId,
      });
    else window.history.replaceState({ view: "home" }, "", window.location.pathname + window.location.search);
    const openUrl = (raw: string) => {
      const url = new URL(raw, window.location.origin);
      const target = viewFromUrl(url.search);
      const act = url.searchParams.get("reminderAction");
      openView(target.view, {
        tab: target.tab,
        reminderAction: act === "snooze" || act === "done" ? act : undefined,
        reminderId: url.searchParams.get("reminderId") || undefined,
      });
      window.dispatchEvent(new Event("zest-reminders-changed"));
    };
    // Native notification taps and deep links (app/native-bridge.tsx) arrive as a window event.
    const onAppOpen = (e: Event) => {
      const url = (e as CustomEvent<{ url?: unknown }>).detail?.url;
      if (typeof url === "string") openUrl(url);
    };
    window.addEventListener("zest-open", onAppOpen);
    if (!("serviceWorker" in navigator)) return () => window.removeEventListener("zest-open", onAppOpen);
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "zest-reminders-changed") window.dispatchEvent(new Event("zest-reminders-changed"));
      if (e.data?.type === "zest-open" && typeof e.data.url === "string") openUrl(e.data.url);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("zest-open", onAppOpen);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [openView]);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
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

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice?.outcome === "accepted") setInstallPrompt(null);
  }

  // Planner is one shared, live store: Home → Today is always the same data as Planner.
  useEffect(() => subscribePlanner(setPlannerItems), []);
  useEffect(() => {
    if (!identity) return;
    let alive = true;
    sharedPlannerStore(identity)
      .then((s) => {
        if (!alive) return;
        setPlannerItems(s.loadCached());
        return s.load();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [identity]);
  const allCalendarItems = useMemo(() => mergePlannerWithExternal(plannerItems, googleCalendarItems), [plannerItems, googleCalendarItems]);
  const homeToday = useMemo(() => plannerTodayItems(allCalendarItems, timezone), [allCalendarItems, timezone]);

  const refreshGoogleCalendar = useCallback(async () => {
    if (mode !== "cloud" || !navigator.onLine) return setGoogleCalendarItems([]);
    const now = new Date();
    try {
      const response = await fetch(`/api/calendar/google/events?timeMin=${encodeURIComponent(new Date(now.getTime()-62*86400000).toISOString())}&timeMax=${encodeURIComponent(new Date(now.getTime()+305*86400000).toISOString())}&timezone=${encodeURIComponent(timezone)}`, { cache: "no-store" });
      if (response.status === 409) return setGoogleCalendarItems([]);
      if (!response.ok) return;
      const body = await response.json();
      setGoogleCalendarItems(Array.isArray(body.events) ? body.events : []);
    } catch {}
  }, [mode, timezone]);

  useEffect(() => {
    refreshGoogleCalendar();
    const onVisible = () => document.visibilityState === "visible" && refreshGoogleCalendar();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refreshGoogleCalendar);
    const timer = window.setInterval(refreshGoogleCalendar, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refreshGoogleCalendar);
      window.clearInterval(timer);
    };
  }, [refreshGoogleCalendar]);

  /** Fresh authoritative data; never lets cached values override server balances. */
  const refresh = useCallback(async () => {
    const p = provider.current;
    if (!p || !navigator.onLine) return;
    lastRefresh.current = Date.now();
    try {
      const [data, profile] = await Promise.all([p.load(), p.loadProfile()]);
      setStore(data);
      if (profile.displayName.trim()) setDisplayName(profile.displayName.trim());
      setTimezone(profile.timezone || deviceTimezone());
      setLocale(profile.locale || navigator.language || "en");
      setStartupCredits(data.credits);
      saveSnapshot({ userId: p.userId, credits: data.credits, displayName: profile.displayName.trim(), mode: p.mode });
      if (identity) (await sharedPlannerStore(identity)).load().catch(() => undefined);
      window.dispatchEvent(new Event("zest-reminders-changed"));
    } catch {
      // Keep showing the last good data; the next focus/online event retries.
    }
  }, [identity]);

  // Before the first hydrated paint: the signed-in person's own cached name, credits and Planner.
  useLayoutEffect(() => {
    setTimezone(deviceTimezone());
    try {
      // Identity first (from the auth cookie, no network): never show another account's snapshot.
      const uid = sessionUserIdSync();
      if (activeUser() !== (uid || "guest")) setActiveUser(uid);
      const snap = JSON.parse(localStorage.getItem(STARTUP_STATE_KEY) || "null") as Snapshot | null;
      if (snap && (snap.userId || null) === uid) {
        if (typeof snap.credits === "number" && snap.mode === "cloud") setStartupCredits(snap.credits);
        if (snap.displayName?.trim()) setDisplayName(snap.displayName.trim());
        if (snap.mode === "cloud" || snap.mode === "local") setMode(snap.mode);
        const cachedPlanner = PlannerStore.loadLastUsed();
        if (cachedPlanner.length) setPlannerItems(cachedPlanner);
      }
    } catch {
      localStorage.removeItem(STARTUP_STATE_KEY);
    }
    setGreetingReady(true);
  }, []);

  // Startup: shell → cached state → session → authoritative cloud state.
  useEffect(() => {
    let mounted = true;
    captureReferral();
    (async () => {
      let p = await getDataProvider();
      if (!mounted) return;
      const adopt = (next: DataProvider) => {
        provider.current = next;
        setMode(next.mode);
        setActiveUser(next.userId || null);
        setIdentity(next.userId || "guest");
      };
      adopt(p);
      const cached = p.loadCached?.();
      const cachedProfile = p.loadCachedProfile?.();
      if (cachedProfile) {
        if (cachedProfile.displayName?.trim()) setDisplayName(cachedProfile.displayName.trim());
        setTimezone(cachedProfile.timezone || deviceTimezone());
        setLocale(cachedProfile.locale || "en");
      }
      if (cached) {
        setStore(cached);
        setReady(true);
      } else if (p.mode === "local") {
        const [data, profile] = await Promise.all([p.load(), p.loadProfile()]);
        if (!mounted) return;
        setStore(data);
        setDisplayName(profile.displayName.trim());
        setTimezone(profile.timezone || deviceTimezone());
        setLocale(profile.locale || navigator.language || "en");
        setReady(true);
      }
      const check = await verifyAccount(p);
      if (!mounted) return;
      if (check === "signed-out") {
        // Session revoked or expired: never keep showing that account's private data.
        clearAccountCaches();
        p = new LocalDataProvider(localStorage);
        adopt(p);
        setStartupCredits(null);
        setDisplayName("");
        setStore(await p.load());
        setReady(true);
        return;
      }
      if (check === "paused") showError("Cloud sync is paused for maintenance. Your data is safe — changes may not save until it resumes.");
      if (check === "ok") {
        Promise.allSettled([registerDevice(), claimPendingReferral(), syncPushSubscription()]);
        if (p.userId) startMarketing(p.userId);
        if (hasGuestData()) {
          try {
            await migrateGuestData(p);
            setSuccess("Your guest scans and plans were saved to your account.");
          } catch {
            showError("Some guest data couldn’t be moved to your account yet. It’s still on this device and will retry.");
          }
        }
      }
      if (check === "ok" || check === "guest" || (check === "offline" && !cached)) {
        try {
          const [data, profile, rewardRules] = await Promise.all([p.load(), p.loadProfile(), p.loadRewardRules?.().catch(() => ({})) ?? {}]);
          if (!mounted) return;
          setStore(data);
          setRules(rewardRules);
          setDisplayName(profile.displayName.trim());
          setTimezone(profile.timezone || deviceTimezone());
          setLocale(profile.locale || navigator.language || "en");
          setStartupCredits(p.mode === "cloud" ? data.credits : null);
          saveSnapshot({ userId: p.userId, credits: data.credits, displayName: profile.displayName.trim(), mode: p.mode });
          lastRefresh.current = Date.now();
          if (p.mode === "local" && profile.retentionDays > 0) {
            const keep = data.scans.filter((s) => Date.parse(s.scannedAt) > Date.now() - profile.retentionDays * 86400000);
            if (keep.length !== data.scans.length) {
              const next = { ...data, scans: keep };
              await p.save(next, data);
              setStore(next);
            }
          }
        } catch {
          if (!cached) showError("Couldn’t load your Zest data. Check your connection — we’ll retry automatically.");
        }
      }
      if (mounted) setReady(true);
    })().catch(() => mounted && showError("Couldn’t open Zest data on this device. Reload to try again."));
    return () => {
      mounted = false;
    };
  }, [showError]);

  // Returning from background, regaining focus or connectivity: refresh quietly (throttled).
  useEffect(() => {
    const maybe = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefresh.current < REFRESH_INTERVAL) return;
      refresh();
    };
    const online = () => {
      lastRefresh.current = 0;
      maybe();
    };
    document.addEventListener("visibilitychange", maybe);
    window.addEventListener("focus", maybe);
    window.addEventListener("online", online);
    return () => {
      document.removeEventListener("visibilitychange", maybe);
      window.removeEventListener("focus", maybe);
      window.removeEventListener("online", online);
    };
  }, [refresh]);

  useEffect(() => {
    if (editingIndex !== null) dialogRef.current?.showModal();
  }, [editingIndex]);

  async function persist(next: LocalState) {
    if (!provider.current) throw new Error("Storage is not ready.");
    await provider.current.save(next, store);
    if (provider.current.mode === "cloud") next = await provider.current.load();
    setStore(next);
    if (provider.current.mode === "cloud") {
      setStartupCredits(next.credits);
      saveSnapshot({ userId: provider.current.userId, credits: next.credits, displayName, mode: "cloud" });
    }
  }

  /** A new scan, plan or history entry is being reviewed: forget the previous review's save state. */
  function startReview() {
    reviewItemIds.current = new Map();
    setSaveOutcome(null);
  }

  async function scanFile(file?: File) {
    if (!file || !ready || busy) return;
    if (!navigator.onLine) {
      showError("Scanning needs an internet connection. Your saved history and Planner are still available.");
      return;
    }
    setError("");
    setErrorAction(null);
    setSuccess("");

    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      showError("Zest Snap reads photos, screenshots (JPEG, PNG, WebP) and PDF documents.");
      return;
    }
    if (isImage && !["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type) && file.size > 0) {
      showError("This image format isn’t supported yet. Use a JPEG, PNG or WebP image.");
      return;
    }
    if (isPdf && file.size > 3_000_000) {
      showError("This PDF is too large to scan. Please use a PDF smaller than 3 MB, or photograph the relevant page.");
      return;
    }
    if (isImage && file.size > 15_000_000) {
      showError("This photo is too large to scan. Please choose a smaller image.");
      return;
    }

    setBusy(true);
    setScanStage(isPdf ? "Preparing your PDF..." : "Preparing your photo...");
    try {
      const prepared = await prepareFileForScan(file);
      if (prepared.dataUrl.length > 4_000_100) throw new Error("This file is still too large after compression. Try a smaller image or PDF.");
      setScanStage("Finding dates and times...");
      const requestId = crypto.randomUUID();
      let res: Response;
      try {
        res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Request-Id": requestId, "X-Zest-Device": deviceId() },
          signal: AbortSignal.timeout(65000),
          body: JSON.stringify({ dataUrl: prepared.dataUrl, mimeType: prepared.mimeType, fileName: file.name, timezone, locale, interests }),
        });
      } catch (e) {
        throw new Error(
          e instanceof DOMException && e.name === "TimeoutError"
            ? "This is taking longer than expected. Check your connection and try again — you won’t be charged twice."
            : "Connection lost while scanning. Check your internet and try again — you won’t be charged twice.",
        );
      }

      setScanStage("Organising your events...");
      const raw = await res.text();
      let payload: (ExtractionResult & { trialRemaining?: number }) | { error?: string; code?: string } | null = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }

      if (!res.ok) {
        const code = payload && "code" in payload ? payload.code : undefined;
        if (res.status === 413 && !code) throw new Error("This file is too large to scan. Try a smaller PDF or photo.");
        const message = (payload && "error" in payload && payload.error) || "We couldn’t scan this file right now. Please try again.";
        if (code === "guest_trial_exhausted" && mode === "local") {
          rememberGuestTrial(0);
          openGuestPremium();
          return;
        }
        if (code === "sign_in_required" && mode === "local") {
          showError(message, "signup");
          return;
        }
        if ((code === "allowance_exhausted" || code === "device_free_limit") && mode === "cloud") {
          trackConversion("free_limit_reached", "free_limit");
          showError(message, "plans");
          return;
        }
        throw new Error(message);
      }
      if (!payload || !("events" in payload) || !Array.isArray(payload.events)) throw new Error("The scan finished, but the result could not be read. Please try again.");

      const scan: StoredScan = {
        id: requestId,
        fileName: friendlySourceName(file),
        scannedAt: new Date().toISOString(),
        documentType: payload.documentType,
        summary: payload.summary,
        events: payload.events,
        warnings: payload.warnings,
      };

      await persist({ ...store, scans: [scan, ...store.scans.filter((s) => s.id !== scan.id)] });

      setActiveScan(scan.id);
      startReview();
      setResult(normalizeDocumentType(payload));
      hapticSuccess();
      setSelected(payload.events.map((_: ExtractedEvent, i: number) => i).filter((i: number) => !duplicateOf(payload.events[i])));
      openView("review");
      if (mode === "local" && typeof payload.trialRemaining === "number") rememberGuestTrial(payload.trialRemaining);
      if (mode === "local" && typeof payload.trialRemaining === "number")
        setSuccess(
          payload.trialRemaining > 0
            ? `Free trial: ${payload.trialRemaining} scan${payload.trialRemaining === 1 ? "" : "s"} left on this device. Create a free account to keep scanning and sync.`
            : "That was your last free trial scan. Create a free account to keep scanning and sync your plans.",
        );
    } catch (e) {
      showError(e instanceof Error ? e.message : "We couldn’t scan this file.");
    } finally {
      setBusy(false);
      setScanStage("");
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /** Native camera inside the iOS/Android apps; the browser camera input everywhere else. */
  /**
   * A guest who has used the trial scans goes straight to the Premium page ("You’ve captured 3 important
   * moments."), which offers a free account and Pro. Their scans and plans stay here. A full load, so the page's
   * fixed light look applies from the first frame. The server still enforces the trial.
   */
  function openGuestPremium() {
    trackConversion("guest_limit_reached", "guest_limit");
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full load on purpose (see above)
    window.location.assign("/upgrade?from=guest");
  }

  /** Guests who have used their trial see the upgrade options instead of a file picker. */
  function guestTrialUsedUp() {
    if (mode !== "local" || knownGuestTrialRemaining() !== 0) return false;
    openGuestPremium();
    return true;
  }

  async function takePhoto() {
    if (guestTrialUsedUp()) return;
    if (!nativeCameraAvailable()) return cameraRef.current?.click();
    try {
      await scanFile(await capturePhoto("camera"));
    } catch (e) {
      if (e instanceof CaptureCancelled) return;
      showError(e instanceof Error && e.message ? e.message : "The camera couldn’t open. Try Upload instead.");
    }
  }

  function toggle(index: number) {
    setSaveOutcome(null);
    setSelected((s) => (s.includes(index) ? s.filter((i) => i !== index) : [...s, index]));
  }

  const plannerPrints = useMemo(() => new Set(plannerItems.filter((i) => i.status !== "cancelled").map(plannerFingerprint)), [plannerItems]);
  /** "Already in your Zest agenda": present in Planner or previously added to the device calendar. */
  function duplicateOf(event: ExtractedEvent) {
    const key = eventKey(event);
    if (store.events.some((e) => eventKey(e) === key)) return true;
    try {
      return plannerPrints.has(plannerFingerprint(extractionToPlannerSuggestion(event, "x").item));
    } catch {
      return false;
    }
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
      showError(e instanceof Error ? e.message : "Check event details.");
      return;
    }
    const events = [...result.events];
    events[editingIndex] = draft;
    try {
      await persist({ ...store, scans: store.scans.map((s) => (s.id === activeScan ? { ...s, events } : s)) });
    } catch {
      showError("Could not save changes. Try again.");
      return;
    }
    setResult({ ...result, events });
    setSaveOutcome(null);
    setEditingIndex(null);
    setDraft(null);
  }

  /**
   * Saves the selected review events. Works for photo scans and for Plan with Zest results (which have no scan),
   * reports every event's outcome, and can be retried: saved events are recognised as duplicates and failed ones
   * keep their ids, so nothing is inserted twice.
   */
  async function saveSelectedToPlanner(indexes: number[]) {
    if (!result || !indexes.length || savingRef.current) return;
    if (!identity) {
      showError("Zest is still loading your Planner. Try again in a moment.");
      return;
    }
    savingRef.current = true;
    setSavingToPlanner(true);
    setBusy(true);
    setError("");
    setSuccess("");
    setSaveOutcome(null);
    try {
      const planner = await sharedPlannerStore(identity);
      // Plan with Zest results are not scans: their items are saved without a scan link.
      const scanId = activeScan && store.scans.some((s) => s.id === activeScan) ? activeScan : undefined;
      const outcome = await saveEventsToPlanner({
        events: result.events,
        indexes,
        isDuplicate: duplicateOf,
        toItem: (event, index) => {
          const item = extractionToPlannerSuggestion(event, scanId ?? "").item;
          let id = reviewItemIds.current.get(index);
          if (!id) reviewItemIds.current.set(index, (id = item.id));
          return { ...item, id, sourceScanId: scanId };
        },
        upsert: (item) => planner.upsert(item),
      });
      setSaveOutcome(outcome);
      // Keep only what still needs attention selected: failed events can be retried as they are.
      setSelected(outcome.failed);
      if (outcome.saved.length) {
        hapticSuccess();
        if (mode === "cloud") refresh();
      }
    } catch (e) {
      // The Planner itself could not be opened: nothing was saved, the selection and edits stay as they are.
      console.error("planner_save_failed", e instanceof Error ? e.message : e);
      showError("Couldn’t save your events. Please try again.");
    } finally {
      savingRef.current = false;
      setSavingToPlanner(false);
      setBusy(false);
    }
  }

  /** Opens Planner › Upcoming, which lists the just-saved events (today's included until their time passes). */
  function viewSavedInPlanner() {
    openView("calendar", { tab: "upcoming" });
  }

  async function addToCalendar(event: ExtractedEvent) {
    if (!event.startDate) {
      showError("Check the date before adding this event to your calendar.");
      return;
    }
    setError("");
    try {
      let addedDirectly = false;
      let sentToDevice = false;
      if (mode === "cloud") {
        const response = await fetch("/api/calendar/google/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event, timezone }),
        });
        if (response.ok) {
          addedDirectly = true;
        } else {
          const body = await response.json().catch(() => ({}));
          if (body?.error === "google_calendar_reconnect_required") {
            showError("Reconnect Google Calendar in Settings, then try again.");
            return;
          }
          if (body?.error !== "google_calendar_not_connected" && response.status !== 409) {
            throw new Error("Could not add this event to Google Calendar.");
          }
        }
      }

      if (!addedDirectly && deviceCalendarAvailable()) {
        // iOS/Android apps without a Google Calendar connection: the system "New Event" editor, pre-filled.
        if ((await addExtractedEventToDevice(event)) === "cancelled") return;
        sentToDevice = true;
        hapticSuccess();
      } else if (!addedDirectly) {
        // Guests and users who have not connected Google Calendar get a pre-filled Google
        // Calendar screen. This is the fallback only; it never downloads an .ics file.
        const url = googleCalendarUrl(event, timezone);
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) window.location.assign(url);
      }

      if (!store.events.some((x) => eventKey(x) === eventKey(event))) {
        const now = new Date().toISOString();
        await persist({
          ...store,
          events: [...store.events, { ...event, id: crypto.randomUUID(), addedAt: now, exportedAt: now }],
          firstCalendarRewarded: true,
        });
      }
      setSuccess(addedDirectly ? "Added to Google Calendar." : sentToDevice ? "Sent to your calendar." : "Google Calendar opened with the event ready to save.");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not add this event to your calendar.");
    }
  }

  async function saveTimetableToPlanner() {
    if (!result || !activeScan || !identity) return;
    if (!scheduleStart || !scheduleEnd || scheduleEnd < scheduleStart) return showError("Choose the timetable start and end dates first.");
    setBusy(true);
    try {
      const planner = await sharedPlannerStore(identity);
      let saved = 0;
      for (const raw of result.events) {
        const event = materializeWeeklySchedule([raw], scheduleStart, scheduleEnd)[0];
        const dates = event.recurrence === "weekly" ? weeklyOccurrences(event, scheduleStart, scheduleEnd) : event.startDate ? [event.startDate] : [];
        for (const date of dates) {
          const occurrence = { ...event, startDate: date, endDate: date, recurrence: "none" as const };
          await planner.upsert(extractionToPlannerSuggestion(occurrence, activeScan).item);
          saved++;
        }
      }
      setSuccess(`${saved} timetable entries saved to Planner.`);
      openView("calendar", { tab: "upcoming" });
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not save this timetable.");
    } finally {
      setBusy(false);
    }
  }

  async function createExamStudyPlan() {
    if (!result || !activeScan || !identity) return;
    const exams = result.events.filter((e) => e.startDate);
    if (!exams.length) return showError("Review the exam dates first.");
    setBusy(true);
    try {
      const planner = await sharedPlannerStore(identity);
      let created = 0;
      for (const exam of exams) {
        const examDate = new Date(exam.startDate + "T12:00:00Z");
        for (const [days, label] of [[14, "Start revision"], [7, "Practice questions"], [2, "Final review"]] as const) {
          const due = new Date(examDate); due.setUTCDate(due.getUTCDate() - days);
          if (due.getTime() < Date.now() - 86400000) continue;
          const now = new Date().toISOString();
          await planner.upsert({
            id: crypto.randomUUID(), type: "task", title: `${label}: ${exam.title}`,
            description: `Study task created from the exam timetable for ${exam.title} on ${exam.startDate}.`,
            startDate: "", endDate: "", startTime: "", endTime: "", dueDate: due.toISOString().slice(0,10), dueTime: "",
            allDay: true, timezone: exam.timezone || timezone, location: "", status: "open", source: "scan",
            sourceScanId: activeScan, createdAt: now, updatedAt: now,
          });
          created++;
        }
      }
      setSuccess(`${created} study To-Dos added.`);
      openView("todo");
    } catch (e) { showError(e instanceof Error ? e.message : "Could not create the study plan."); }
    finally { setBusy(false); }
  }

  async function createSharedPlanFromScan(documentType: ExtractionResult["documentType"]) {
    if (!result) return;
    if (mode !== "cloud") return goToSignUp();
    let usable = result.events;
    if (documentType === "timetable") {
      if (!scheduleStart || !scheduleEnd || scheduleEnd < scheduleStart) return showError("Choose the timetable start and end dates first.");
      usable = materializeWeeklySchedule(result.events, scheduleStart, scheduleEnd);
    }
    usable = usable.filter((event) => isValidDate(event.startDate));
    if (!usable.length) return showError("Review the schedule dates first. Zest will not guess missing dates.");
    setBusy(true);
    try {
      const db = createClient();
      const kind = documentType === "meal_schedule" ? "meals" : "timetable";
      const name = documentType === "exam_timetable" ? "Exam timetable" : documentType === "meal_schedule" ? "Meal plan" : "Timetable";
      const { data: planId, error: planError } = await db.rpc("create_shared_plan", { p_name: name, p_kind: kind });
      if (planError) throw planError;
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Sign in to save a shared plan.");
      const rows = usable.map((event) => ({
        plan_id: planId,
        creator_id: user.id,
        item_type: documentType === "meal_schedule" ? "meal" : "event",
        title: event.title,
        description: event.description || "",
        start_date: event.startDate || null,
        end_date: event.endDate || event.startDate || null,
        start_time: event.startTime || null,
        end_time: event.endTime || null,
        all_day: event.allDay,
        timezone: event.timezone || timezone,
        location: event.location || "",
        recurrence: event.recurrence === "weekly" ? { frequency: "weekly", dayOfWeek: event.dayOfWeek || "", until: scheduleEnd || null } : {},
        source: "scan",
      }));
      const { error: itemError } = await db.from("shared_plan_items").insert(rows);
      if (itemError) throw itemError;
      router.push(`/shared/${planId}`);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not create the shared plan.");
    } finally {
      setBusy(false);
    }
  }

  async function shareExtractedEvent(event: ExtractedEvent) {
    if (mode !== "cloud") return goToSignUp();
    try {
      const db = createClient();
      const { data, error } = await db.rpc("create_public_event_share", { p_event: event });
      if (error) throw error;
      const url = `${window.location.origin}/share/${data}`;
      const text = `${event.title}\n${event.startDate}${event.startTime ? " · " + event.startTime : ""}\n${url}`;
      if (await shareTextNatively({ title: event.title, text, url })) return;
      await navigator.clipboard.writeText(url);
      setSuccess("Share link copied.");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not share this event.");
    }
  }

  function closeVoicePlanner() {
    stopNativeSpeech().catch(() => undefined);
    try { voiceRecognition.current?.stop?.(); } catch {}
    voiceRecognition.current = null;
    setVoiceListening(false);
    setVoiceOpen(false);
  }

  async function toggleVoiceListening() {
    if (voiceListening) { stopNativeSpeech().catch(() => undefined); try { voiceRecognition.current?.stop?.(); } catch {} return; }
    if (hasNativeSpeech()) {
      const committed = voiceText.trim();
      setVoiceListening(true);
      const started = await startNativeSpeech(locale || navigator.language || "en", (heard) => setVoiceText((committed + " " + heard).trim()), () => setVoiceListening(false));
      if (started === "started") return;
      setVoiceListening(false);
      return showError(started === "denied" ? blockedPermissionHelp("microphone") + " You can still type your plan." : "Voice input isn't available on this device. You can still type your plan.");
    }
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) return showError("Voice input is not available in this browser. You can still type your plan.");
    const recognition = new Recognition();
    recognition.lang = locale || navigator.language || "en";
    recognition.continuous = true;
    recognition.interimResults = true;
    let committed = voiceText.trim();
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const words = String(event.results[i][0]?.transcript || "").trim();
        if (!words) continue;
        if (event.results[i].isFinal) committed = (committed + " " + words).trim();
        else interim = (interim + " " + words).trim();
      }
      setVoiceText((committed + " " + interim).trim());
    };
    recognition.onerror = (event: any) => {
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") return showError("Microphone access is blocked for this site. Allow it in your browser settings, or type your plan.");
      if (event?.error !== "aborted" && event?.error !== "no-speech") showError("I couldn’t hear that clearly. Try again or type your plan.");
    };
    recognition.onend = () => { voiceRecognition.current = null; setVoiceListening(false); };
    voiceRecognition.current = recognition;
    setVoiceListening(true);
    recognition.start();
  }

  async function organiseVoicePlan() {
    const text = voiceText.trim();
    if (!text) return showError("Say or type what you want to plan first.");
    if (mode !== "cloud") return goToSignUp();
    stopNativeSpeech().catch(() => undefined);
    try { voiceRecognition.current?.stop?.(); } catch {}
    setVoiceBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000), body: JSON.stringify({ text, timezone, locale }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Zest could not organise that plan.");
      const planned = normalizeDocumentType(body as ExtractionResult);
      setActiveScan(null); startReview(); setResult(planned);
      setSelected(planned.events.map((event, i) => isValidDate(event.startDate) ? i : -1).filter(i => i >= 0));
      closeVoicePlanner(); openView("review");
      if (!planned.events.length) showError("I couldn’t find an actionable date yet. Try adding a day or time.");
    } catch (e) { showError(e instanceof Error ? e.message : "Zest could not organise that plan."); }
    finally { setVoiceBusy(false); }
  }

  const goToSignUp = () => router.push("/login?mode=signup&next=" + encodeURIComponent(window.location.pathname + window.location.search));

  return (
    <main className="appShell">
      <header className="appHeader">
        <a className="brand" href="https://zestsnap.app" aria-label="Zest Snap home">
          Zest <span>Snap</span>
        </a>
        <div className="appHeaderActions">
          <button className="creditPill" onClick={() => openView("rewards")} aria-label={mode === "cloud" ? "Zest Credits and rewards" : "Open rewards"}>
            <Sparkles size={14} aria-hidden="true" />{" "}
            {mode === "cloud" ? `${ready && store.earned ? store.credits : (startupCredits ?? "—")} credits` : "Rewards"}
          </button>
          <a className="settingsIconButton" href="/settings" aria-label="Settings">
            <SettingsIcon aria-hidden="true" />
          </a>
        </div>
      </header>

      <div className="appContent">
        {error && view !== "home" && (
          <div className="errorBox" role="alert">
            {error}
          </div>
        )}
        {view === "home" && (
          <>
            {!installed && installPrompt && !isNative() && (
              <button className="button alt" onClick={installApp}>
                Install Zest Snap
              </button>
            )}
            <section className="appIntro homeHero">
              <div className="homeGreeting" style={greetingReady ? undefined : { visibility: "hidden" }}>
                {/* /app is prerendered, so the time of day is only known in the browser; render it after mount. */}
                {greetingReady ? greeting(timezone) : "Hello"}
                {displayName ? `, ${displayName.split(" ")[0]}` : ""} <span aria-hidden="true">👋</span>
              </div>
              <h1>What do you want to remember?</h1>
              <p>Snap or upload it. Zest finds the important dates.</p>
            </section>

            <section className="captureCard captureCardHome">
              <div className="captureMark zestCaptureMark">
                <Camera />
              </div>
              <h2>Capture something with a date</h2>
              <p>Appointments, notices, bookings, schedules and PDFs.</p>
              <div className="captureActions">
                <button className="button" onClick={takePhoto} disabled={busy || !ready}>
                  {busy ? <Loader2 className="spin" size={20} /> : <Camera size={20} />} Take photo
                </button>
                <button className="button alt" onClick={() => !guestTrialUsedUp() && fileRef.current?.click()} disabled={busy || !ready}>
                  <Upload size={20} /> Upload
                </button>
              </div>
              <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(e: ChangeEvent<HTMLInputElement>) => scanFile(e.target.files?.[0])} />
              <input ref={fileRef} hidden type="file" accept="image/*,application/pdf" onChange={(e: ChangeEvent<HTMLInputElement>) => scanFile(e.target.files?.[0])} />
              {busy && (
                <div className="scanStatus" role="status">
                  <Loader2 className="spin" size={17} />
                  {scanStage || "Reading your file..."}
                </div>
              )}
              {error && (
                <div className="errorBox" role="alert">
                  <AlertTriangle size={16} />
                  {error}
                  {errorAction === "signup" && (
                    <button className="textButton" onClick={goToSignUp}>
                      Create a free account
                    </button>
                  )}
                  {errorAction === "plans" && (
                    <button className="textButton" onClick={() => router.push("/upgrade?from=free_limit")}>
                      See plans
                    </button>
                  )}
                </div>
              )}
              {success && (
                <div className="successBox" role="status">
                  <CheckCircle2 size={16} />
                  {success}
                </div>
              )}
            </section>

            <section className="planWithZest">
              <button className="planWithZestButton" onClick={() => setVoiceOpen(true)} disabled={busy || !ready}>
                <span className="planWithZestIcon"><Mic size={19} /></span>
                <span><b>Plan with Zest</b><small>Say what you need to do</small></span>
                <ChevronRight size={18} />
              </button>
            </section>
            <section className="homeToday">
              <div className="homeTodayHead">
                <div className="homeTodayTitle">
                  <span>
                    <CalendarDays />
                  </span>
                  <div>
                    <h2>Today</h2>
                    <p>
                      {homeToday.length} {homeToday.length === 1 ? "thing" : "things"} in your day
                    </p>
                  </div>
                </div>
                <button className="homeViewAll" onClick={() => openView("calendar", { tab: "today" })}>
                  View all <ChevronRight size={17} />
                </button>
              </div>
              <div className="homeTimeline">
                {homeToday.slice(0, 3).map((item, i) => {
                  const time = plannerReferenceTime(item);
                  return (
                    <button key={item.id} className={"homeTimelineItem tone" + (i % 3)} onClick={() => openView("calendar", { tab: "today" })}>
                      <span className="homeTimelineTime">
                        {time ? new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "UTC" }).format(new Date(`1970-01-01T${time}:00Z`)) : "All day"}
                      </span>
                      <span className="homeTimelineDot" />
                      <span className="homeTimelineBody">
                        <b>{item.status === "completed" ? <s>{item.title}</s> : item.title}</b>
                        <small>{item.location || (item.type === "event" ? (time ? "Today" : "All day") : item.type[0].toUpperCase() + item.type.slice(1))}</small>
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  );
                })}
                {!homeToday.length && (
                  <p className="homeTodayEmpty">Your day is clear.</p>
                )}
              </div>
            </section>
            {!homeToday.length && (
              <section className="homeIdeas" aria-labelledby="home-ideas-title">
                <h2 id="home-ideas-title">What can I snap?</h2>
                <ul>
                  {snapExamples(interests).map((x) => (
                    <li key={x.id}><span aria-hidden="true">{x.emoji}</span> {x.text}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {view === "review" && result && (
          <>
            <section className="reviewTop">
              <button className="textButton" onClick={() => openView("home")}>
                ← Scan another
              </button>
              <div className="eyebrow">AI REVIEW</div>
              <h1>
                {result.events.length === 0
                  ? "No actionable dates found"
                  : `${result.events.length} ${result.events.length === 1 ? "event" : "events"} found`}
              </h1>
              <p>{result.summary}</p>
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
                onClick={() => {
                  setSaveOutcome(null);
                  setSelected(result.events.map((_, i) => i));
                }}
              >
                Select all
              </button>{" "}
              ·{" "}
              <button
                className="textButton"
                onClick={() => {
                  setSaveOutcome(null);
                  setSelected([]);
                }}
              >
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
                        {event.confidence < 0.7 && (
                          // Only uncertain extractions are flagged, so the person knows what to check before saving.
                          <span className="confidence low">Check details</span>
                        )}
                      </div>
                      <div className="eventMeta">
                        <span>
                          <CalendarDays size={16} />
                          {event.startDate ? formatDisplayDate(event.startDate) : "Date needs review"}
                          {event.startTime ? " · " + formatDisplayTime(event.startTime) : ""}
                        </span>
                        {event.location && (
                          <span>
                            <MapPin size={16} />
                            {event.location}
                          </span>
                        )}
                      </div>
                      {event.description && <p className="reason">{event.description}</p>}
                      {event.confidence < 0.7 && event.confidenceReason && (
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
                          onClick={() => addToCalendar(event)}
                          disabled={duplicate}
                        >
                          <CalendarDays size={16} />
                          {duplicate ? "In your agenda" : "Add to calendar"}
                        </button>
                        <button
                          className="button alt small"
                          onClick={() => shareExtractedEvent(event)}
                        >
                          <UsersRound size={16} />
                          Share
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {(result.documentType === "timetable" || result.documentType === "exam_timetable" || result.documentType === "meal_schedule") && (
              <div className="detectedPlanBanner">
                <div className="detectedPlanCopy">
                  <span className="eyebrow">{result.documentType === "exam_timetable" ? "EXAM TIMETABLE" : result.documentType === "meal_schedule" ? "MEAL SCHEDULE" : "TIMETABLE"} DETECTED</span>
                  <b>{result.events.length} {result.documentType === "exam_timetable" ? "exams" : result.documentType === "meal_schedule" ? "meal items" : "schedule items"} found</b>
                  <small>{result.documentType === "timetable" ? "Set the term or semester dates once, then Zest builds the recurring schedule." : "Review the dates before adding anything."}</small>
                  {result.documentType === "timetable" && <div className="scheduleRangeFields">
                    <label><span>Starts</span><input type="date" min={MIN_DATE} max={MAX_DATE} value={scheduleStart} onChange={e=>setScheduleStart(e.target.value)} /></label>
                    <label><span>Ends</span><input type="date" max={MAX_DATE} value={scheduleEnd} min={scheduleStart||MIN_DATE} onChange={e=>setScheduleEnd(e.target.value)} /></label>
                  </div>}
                </div>
                <div className="detectedPlanActions">
                  {result.documentType === "timetable" && <button className="button alt small" disabled={busy||!scheduleStart||!scheduleEnd} onClick={saveTimetableToPlanner}><CalendarDays size={16}/> Add schedule to Planner</button>}
                  {result.documentType === "exam_timetable" && <button className="button alt small" disabled={busy} onClick={createExamStudyPlan}><ListChecks size={16}/> Create study To-Dos</button>}
                  <button className="button alt small" disabled={busy||(result.documentType==="timetable"&&(!scheduleStart||!scheduleEnd))} onClick={() => createSharedPlanFromScan(result.documentType)}>
                    <UsersRound size={16} /> Save as shared plan
                  </button>
                </div>
              </div>
            )}

            <div className="stickyAction" aria-live="polite">
              <div>
                {saveOutcome ? (
                  <b className={saveOutcome.failed.length || saveOutcome.invalid.length ? "saveResult attention" : "saveResult"} role="status">
                    {saveSummary(saveOutcome)}
                  </b>
                ) : (
                  <b>{selected.length} selected</b>
                )}
                {!selected.length && !saveOutcome?.saved.length && <span id="save-hint">Select at least one event to save</span>}
              </div>
              <div className="stickyActions">
                {saveOutcome?.saved.length && !selected.length ? (
                  <button className="button" onClick={viewSavedInPlanner}>
                    View in Planner
                  </button>
                ) : (
                  <button
                    className="button"
                    disabled={!selected.length || savingToPlanner}
                    aria-describedby={!selected.length ? "save-hint" : undefined}
                    aria-busy={savingToPlanner}
                    onClick={() => saveSelectedToPlanner(selected)}
                  >
                    {savingToPlanner ? (
                      <>
                        <Loader2 size={17} className="spin" aria-hidden="true" /> Saving…
                      </>
                    ) : saveOutcome?.failed.length ? (
                      `Retry ${selected.length}`
                    ) : (
                      `Save ${selected.length || ""} to Planner`.replace("  ", " ")
                    )}
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {view === "history" && (
          <HistoryView
            scans={store.scans}
            onOpen={(s) => {
              setActiveScan(s.id);
              startReview();
              setResult(normalizeDocumentType({ ...s, warnings: s.warnings || [] }));
              setSelected(s.events.map((_, i) => i));
              openView("review");
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
        {(view === "calendar" || plannerVisited) && identity && (
          <div hidden={view !== "calendar"} aria-hidden={view !== "calendar"}>
            {success && view === "calendar" && (
              <div className="successBox standalone" role="status">
                <CheckCircle2 size={18} />
                {success}
              </div>
            )}
            <PlannerView
              identity={identity}
              timezone={timezone}
              locale={locale}
              signedIn={mode === "cloud"}
              request={plannerRequest}
              onTabChange={setPlannerTab}
              onSignIn={goToSignUp}
              onNotice={(kind, message) => (kind === "success" ? (setError(""), setSuccess(message)) : showError(message))}
            />
          </div>
        )}
        {view === "todo" && identity && (
          <TodoView
            identity={identity}
            timezone={timezone}
            locale={locale}
            items={allCalendarItems}
            onOpenPlanner={() => openView("calendar", { tab: "today" })}
            onNotice={(kind, message) => {
              if (kind === "success") {
                setError("");
                setSuccess(message);
                window.setTimeout(() => setSuccess(""), 1800);
              } else showError(message);
            }}
          />
        )}
        {view === "shared" && (
          <SharedView
            signedIn={mode === "cloud"}
            onSignIn={goToSignUp}
            onNotice={(kind, message) => {
              if (kind === "success") {
                setError("");
                setSuccess(message);
                window.setTimeout(() => setSuccess(""), 2200);
              } else showError(message);
            }}
          />
        )}
        {view === "rewards" && (
          <RewardsView
            ready={ready}
            signedIn={mode === "cloud"}
            store={store}
            rules={rules}
            credits={store.earned ? store.credits : startupCredits}
            onSignIn={goToSignUp}
            onOpen={(target) => openView(target === "scan" ? "home" : "calendar", target === "scan" ? {} : { tab: target === "reminder" ? "reminders" : "today" })}
            onFeedback={async (rating, feedback) => {
              if (mode !== "cloud") {
                goToSignUp();
                return false;
              }
              try {
                const db = createClient();
                const { data, error } = await db.rpc("submit_product_feedback", { p_rating: rating, p_feedback: feedback });
                if (error) throw error;
                await refresh();
                setSuccess(Number(data) > 0 ? `Thanks for the feedback — +${data} Zest Credits.` : "Thanks — your feedback was received.");
                return true;
              } catch (e) {
                showError(
                  e instanceof Error && e.message.includes("feedback_required")
                    ? "Add a rating or a few words first."
                    : "We couldn’t send your feedback right now. Please try again.",
                );
                return false;
              }
            }}
            onInvite={async () => {
              if (mode !== "cloud") return goToSignUp();
              try {
                const code = await provider.current?.createReferral();
                if (!code) return goToSignUp();
                const url = `https://zestsnap.app/r/${encodeURIComponent(code)}`;
                const shareText = "Turn photos, screenshots and documents into plans with Zest Snap 📅\n\nTry Zest Snap:";
                const nativeShare = await shareTextNatively({ title: "Zest Snap", text: shareText, url });
                if (nativeShare) return;
                if (navigator.share) await navigator.share({ title: "Zest Snap", text: shareText, url });
                else {
                  await navigator.clipboard.writeText(url);
                  setSuccess("Invite link copied.");
                }
              } catch (e) {
                if (e instanceof DOMException && e.name === "AbortError") return; // share sheet cancelled: nothing happens
                showError("We couldn’t open sharing right now. Please try again.");
              }
            }}
          />
        )}
        {(view === "rewards" || view === "shared") && success && (
          <div className="successBox standalone" role="status">
            <CheckCircle2 size={18} />
            {success}
          </div>
        )}

        {voiceOpen && (
          <div className="voicePlanBackdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && closeVoicePlanner()}>
            <section className="voicePlanSheet" role="dialog" aria-modal="true" aria-labelledby="voice-plan-title">
              <div className="voicePlanHead">
                <div><span className="eyebrow">PLAN WITH ZEST</span><h2 id="voice-plan-title">What’s your plan?</h2></div>
                <button className="iconButton" onClick={closeVoicePlanner} aria-label="Close"><X size={20} /></button>
              </div>
              <p className="voicePlanHint">Speak naturally. For example: “Tomorrow at 9, dentist. At 2, call Sarah. Remind me at 6 to buy groceries.”</p>
              <textarea className="voicePlanText" value={voiceText} maxLength={2000} onChange={(e) => setVoiceText(e.target.value)} placeholder="Say it or type it here…" />
              <button className={"voiceRecordButton " + (voiceListening ? "listening" : "")} onClick={toggleVoiceListening} type="button">
                {voiceListening ? <Square size={20} /> : <Mic size={22} />}
                <span>{voiceListening ? "Stop listening" : "Start speaking"}</span>
              </button>
              <div className="voicePlanPrivacy">Your words are sent only when you choose <b>Organise my plan</b>. Review everything before it is saved.</div>
              <button className="button voicePlanSubmit" disabled={voiceBusy || !voiceText.trim()} onClick={organiseVoicePlan}>
                {voiceBusy ? <Loader2 className="spin" size={19} /> : <Sparkles size={19} />} {voiceBusy ? "Organising…" : "Organise my plan"}
              </button>
            </section>
          </div>
        )}
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
              <label>
                <span>Category</span>
                <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as ExtractedEvent["category"] })}>
                  {(["event", "school", "meeting", "appointment", "travel", "payment", "deadline", "other"] as const).map((c) => (
                    <option key={c} value={c}>
                      {c[0].toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="fieldGrid">
                <label>
                  <span>Date</span>
                  <input
                    type="date" min={MIN_DATE} max={MAX_DATE}
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
                    onChange={(e) => setDraft(withStartTime(draft, e.target.value))}
                  />
                </label>
              </div>
              <div className="fieldGrid">
                <label>
                  <span>End date</span>
                  <input
                    type="date" min={MIN_DATE} max={MAX_DATE}
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

      <nav className="bottomNav" aria-label="Main">
        <NavButton active={view === "home" || view === "review"} label="Home" onClick={() => openView("home")} icon={<HomeIcon />} />
        <NavButton active={view === "calendar" && (plannerTab ?? plannerRequest.tab) !== "reminders"} label="Planner" onClick={() => openView("calendar", { tab: "today" })} icon={<CalendarDays />} />
        <NavButton active={view === "todo"} label="To-do" onClick={() => openView("todo")} icon={<span className="todoNavGlyph"><Check /></span>} />
        <NavButton active={view === "calendar" && (plannerTab ?? plannerRequest.tab) === "reminders"} label="Reminders" onClick={() => openView("calendar", { tab: "reminders" })} icon={<Bell />} />
        <NavButton active={view === "shared"} label="Shared" onClick={() => openView("shared")} icon={<UsersRound />} />
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
    <button type="button" className={active ? "active" : ""} onClick={onClick} aria-current={active ? "page" : undefined}>
      {icon}
      <small>{label}</small>
    </button>
  );
}

function TodoView({
  identity,
  timezone,
  locale,
  items,
  onOpenPlanner,
  onNotice,
}: {
  identity: string;
  timezone: string;
  locale: string;
  items: PlannerItem[];
  onOpenPlanner: () => void;
  onNotice: (kind: "success" | "error", message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(() => todayDate(timezone));
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [dateMonth, setDateMonth] = useState(() => {
    const [year, month] = todayDate(timezone).split("-").map(Number);
    return { year, month };
  });
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | "today" | "upcoming" | "completed">("all");
  const todos = useMemo(
    () => plannerSort(items.filter((x) => (x.type === "task" || x.type === "deadline") && x.status !== "cancelled")),
    [items],
  );
  const open = todos.filter((x) => x.status !== "completed");
  const completed = todos.filter((x) => x.status === "completed");
  const overdue = open.filter((x) => plannerStatus(x, undefined, timezone) === "overdue");
  const today = open.filter((x) => plannerStatus(x, undefined, timezone) === "today");
  const upcoming = open.filter((x) => !overdue.includes(x) && !today.includes(x));
  const livePlannerItems = useMemo(() => plannerSort(items.filter((x) => x.status !== "cancelled")), [items]);
  const todoCalendar = useMemo(() => monthGrid(dateMonth.year, dateMonth.month, locale, timezone), [dateMonth, locale, timezone]);
  const markedDates = useMemo(() => new Set(livePlannerItems.map(plannerReferenceDate)), [livePlannerItems]);
  const selectedDateItems = useMemo(
    () => livePlannerItems.filter((x) => plannerReferenceDate(x) === dueDate),
    [livePlannerItems, dueDate],
  );

  const formatDate = (date: string) => {
    if (!date) return "No date";
    try {
      return new Intl.DateTimeFormat(locale || undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
    } catch {
      return date;
    }
  };

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean || adding) return;
    setAdding(true);
    try {
      const now = new Date().toISOString();
      const item: PlannerItem = {
        id: crypto.randomUUID(),
        type: "task",
        title: clean,
        description: "",
        startDate: dueDate,
        endDate: dueDate,
        startTime: "",
        endTime: "",
        dueDate,
        dueTime: "",
        allDay: true,
        timezone,
        location: "",
        status: "open",
        source: "manual",
        createdAt: now,
        updatedAt: now,
      };
      const store = await sharedPlannerStore(identity);
      await store.upsert(item);
      setTitle("");
      onNotice("success", "To-do added.");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Could not add this to-do.");
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (item: PlannerItem) => {
    // Only lock the row being saved. A fast second tap is intentionally ignored while
    // the first state is persisted, rather than making the whole To-do list unresponsive.
    if (busyIds.has(item.id)) return;
    setBusyIds((current) => new Set(current).add(item.id));
    try {
      const store = await sharedPlannerStore(identity);
      await store.setCompleted(item.id, item.status !== "completed");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Could not update this to-do.");
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const group = (label: string, rows: PlannerItem[], tone?: string) =>
    rows.length ? (
      <section id={"todo-" + label.toLowerCase()} className={"todoGroup " + (tone || "")}>
        <div className="todoGroupHead">
          <h2>{label}</h2>
          <span>{rows.length}</span>
        </div>
        <div className="todoRows">
          {rows.map((item) => (
            <article className={"todoRow " + (item.status === "completed" ? "completed" : "")} key={item.id}>
              <button
                type="button"
                className="todoCheck"
                aria-label={item.status === "completed" ? "Mark as not done" : "Mark as done"}
                aria-pressed={item.status === "completed"}
                aria-busy={busyIds.has(item.id)}
                onClick={() => toggle(item)}
              >
                {item.status === "completed" && <Check />}
              </button>
              <button type="button" className="todoMain" onClick={onOpenPlanner}>
                <b>{item.title}</b>
                <small>{item.type === "deadline" ? "Deadline" : "To-do"} · {formatDate(item.dueDate || item.startDate)}</small>
              </button>
              <ChevronRight size={18} />
            </article>
          ))}
        </div>
      </section>
    ) : null;

  return (
    <section className="todoView">
      <div className="todoHero">
        <div>
          <h1>To-do</h1>
          <p>{open.length ? `${open.length} still to do` : "You’re all caught up."}</p>
        </div>
      </div>

      <div className="todoFilters" role="tablist" aria-label="To-do filters">
        <button type="button" className={filter === "all" ? "active" : ""} role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>All</button>
        <button type="button" className={filter === "today" ? "active" : ""} role="tab" aria-selected={filter === "today"} onClick={() => setFilter("today")}>Today</button>
        <button type="button" className={filter === "upcoming" ? "active" : ""} role="tab" aria-selected={filter === "upcoming"} onClick={() => setFilter("upcoming")}>Upcoming</button>
        <button type="button" className={filter === "completed" ? "active" : ""} role="tab" aria-selected={filter === "completed"} onClick={() => setFilter("completed")}>Completed</button>
      </div>

      <form className="todoQuickAdd" onSubmit={addTodo}>
        <input
          aria-label="New to-do"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a to-do"
          maxLength={500}
        />
        <button
          type="button"
          className="todoDateButton"
          aria-label={`Choose due date, currently ${formatDate(dueDate)}`}
          onClick={() => {
            const [year, month] = dueDate.split("-").map(Number);
            setDateMonth({ year, month });
            setDatePickerOpen(true);
          }}
        >
          <CalendarDays />
          <span><small>Due date</small><b>{formatDate(dueDate)}</b></span>
          <ChevronRight />
        </button>
        <button type="submit" disabled={!title.trim() || adding}>{adding ? "Adding…" : "Add"}</button>
      </form>

      {!open.length && !completed.length && (
        <div className="todoEmpty">
          <span className="todoEmptyIcon"><Check /></span>
          <b>Nothing on your list yet</b>
          <p>Add something above, or save a task or deadline from a scan.</p>
        </div>
      )}

      {filter === "all" && group("Overdue", overdue, "urgent")}
      {(filter === "all" || filter === "today") && group("Today", today)}
      {(filter === "all" || filter === "upcoming") && group("Upcoming", upcoming)}
      {(filter === "all" || filter === "completed") && group("Completed", completed.slice(0, 8), "done")}

      {filter === "today" && !today.length && (
        <div className="todoEmpty">
          <span className="todoEmptyIcon"><Check /></span>
          <b>Nothing due today</b>
          <p>Your open to-dos due today will appear here.</p>
        </div>
      )}
      {filter === "upcoming" && !upcoming.length && (
        <div className="todoEmpty">
          <span className="todoEmptyIcon"><Check /></span>
          <b>No upcoming to-dos</b>
          <p>Future tasks and deadlines will appear here.</p>
        </div>
      )}
      {filter === "completed" && !completed.length && (
        <div className="todoEmpty">
          <span className="todoEmptyIcon"><Check /></span>
          <b>No completed to-dos yet</b>
          <p>Finished items will appear here after you mark them done.</p>
        </div>
      )}

      {datePickerOpen && (
        <div className="todoDateOverlay" role="presentation" onClick={() => setDatePickerOpen(false)}>
          <section className="todoDateSheet" role="dialog" aria-modal="true" aria-label="Choose due date" onClick={(e) => e.stopPropagation()}>
            <div className="todoDateSheetTop">
              <div>
                <small>Choose due date</small>
                <h2>{formatDate(dueDate)}</h2>
              </div>
              <button type="button" className="iconButton" aria-label="Close date picker" onClick={() => setDatePickerOpen(false)}><X /></button>
            </div>

            <div className="todoCalendarTop">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setDateMonth((m) => m.month === 1 ? { year: m.year - 1, month: 12 } : { year: m.year, month: m.month - 1 })}
              ><ChevronLeft /></button>
              <strong>{new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(dateMonth.year, dateMonth.month - 1, 15)))}</strong>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setDateMonth((m) => m.month === 12 ? { year: m.year + 1, month: 1 } : { year: m.year, month: m.month + 1 })}
              ><ChevronRight /></button>
            </div>

            <div className="todoWeekdays" aria-hidden="true">
              {todoCalendar.weekdayLabels.map((label, i) => <span key={i}>{label}</span>)}
            </div>
            <div className="todoMonthGrid">
              {todoCalendar.cells.map((cell) => (
                <button
                  type="button"
                  key={cell.date}
                  className={`${cell.inMonth ? "" : "outside"} ${dueDate === cell.date ? "selected" : ""}`}
                  aria-label={formatDate(cell.date) + (markedDates.has(cell.date) ? ", has Planner items" : "")}
                  aria-pressed={dueDate === cell.date}
                  onClick={() => setDueDate(cell.date)}
                >
                  <span>{Number(cell.date.slice(-2))}</span>
                  {markedDates.has(cell.date) && <i />}
                </button>
              ))}
            </div>

            <div className="todoDateAgenda">
              <div className="todoDateAgendaHead">
                <b>On this day</b>
                <span>{selectedDateItems.length} {selectedDateItems.length === 1 ? "item" : "items"}</span>
              </div>
              {selectedDateItems.length ? (
                <div className="todoDateAgendaList">
                  {selectedDateItems.slice(0, 5).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        setDatePickerOpen(false);
                        onOpenPlanner();
                      }}
                    >
                      <span className={`todoDateType ${item.type}`}>{item.type === "task" ? "To-do" : item.type}</span>
                      <b>{item.title}</b>
                      <small>{plannerReferenceTime(item) || (item.allDay ? "All day" : "")}</small>
                      <ChevronRight />
                    </button>
                  ))}
                </div>
              ) : (
                <p>No Planner or To-do items on this date.</p>
              )}
            </div>

            <div className="todoDateActions">
              <button type="button" className="button alt" onClick={() => {
                const current = todayDate(timezone);
                const [year, month] = current.split("-").map(Number);
                setDueDate(current);
                setDateMonth({ year, month });
              }}>Today</button>
              <button type="button" className="button" onClick={() => setDatePickerOpen(false)}>Use this date</button>
            </div>
          </section>
        </div>
      )}
    </section>
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

const MILESTONES: { key: string; title: string; hint: string; open?: "scan" | "planner" | "reminder"; icon: React.ReactNode }[] = [
  { key: "first_scan", title: "Complete your first scan", hint: "Capture or upload something with a date", open: "scan", icon: <CheckCircle2 /> },
  { key: "first_planner_item", title: "Add your first Planner item", hint: "Save a scan or tap + in Planner", open: "planner", icon: <CalendarDays /> },
  { key: "first_calendar", title: "Add an event to your device calendar", hint: "Use “Add to device calendar” after a scan", open: "scan", icon: <Download /> },
  { key: "first_reminder", title: "Set your first reminder", hint: "Open Reminders and tap Add", open: "reminder", icon: <Bell /> },
  { key: "first_completed_task", title: "Complete your first task", hint: "Tick off a task or deadline", open: "planner", icon: <ListChecks /> },
  { key: "organised_5_scans", title: "Organise 5 scans", hint: "Save items from 5 different scans to Planner", open: "scan", icon: <Layers /> },
  { key: "organised_10_scans", title: "Organise 10 scans", hint: "Save items from 10 different scans to Planner", open: "scan", icon: <Layers /> },
];

function RewardsView({
  ready,
  signedIn,
  store,
  rules,
  credits,
  onSignIn,
  onOpen,
  onInvite,
  onFeedback,
}: {
  ready: boolean;
  signedIn: boolean;
  store: LocalState;
  rules: Record<string, number>;
  credits: number | null;
  onSignIn: () => void;
  onOpen: (target: "scan" | "planner" | "reminder") => void;
  onInvite: () => void;
  onFeedback: (rating: number | null, feedback: string) => Promise<boolean>;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);
  const earned = new Set(store.earned || []);
  const submitFeedback = async () => {
    if (sending) return;
    setSending(true);
    const ok = await onFeedback(rating, feedback);
    setSending(false);
    if (ok) setFeedbackOpen(false);
  };
  // Completed milestones never show today's amount: they may have been earned under earlier rules.
  const amount = (key: string) => (rules[key] ? `+${rules[key]} credit${rules[key] === 1 ? "" : "s"}` : "");
  const visible = MILESTONES.filter((m) => earned.has(m.key) || !signedIn || rules[m.key]);
  const feedbackDone = earned.has("product_feedback");
  const referrals = (store.earned || []).filter((r) => r === "referral_qualified").length;
  return (
    <section className="rewardsView">
      <h1>Your rewards</h1>
      <p>Earn bonus AI credits for milestones and for helping Zest grow. Credits can pay for extra scans.</p>
      {signedIn ? (
        <div className="rewardBalance">
          <span>Current balance</span>
          <b>{credits ?? "—"}</b>
          <small>{ready && credits !== null ? "Zest Credits" : "Syncing…"}</small>
        </div>
      ) : (
        <button className="rewardBalance" type="button" onClick={onSignIn}>
          <span>Rewards need a free account</span>
          <small>Sign in to earn credits for everything below →</small>
        </button>
      )}
      <div className="rewardRows">
        {visible.map((m) => {
          const done = signedIn && earned.has(m.key);
          if (done)
            return (
              <div className="rewardItem completed" key={m.key}>
                <span className="rewardIcon">{m.icon}</span>
                <span className="rewardCopy">
                  <b>{m.title}</b>
                  <small>Completed</small>
                </span>
                <span className="rewardState">
                  <Check size={18} aria-label="Completed" />
                </span>
              </div>
            );
          return (
            <button className="rewardItem actionable" type="button" key={m.key} onClick={() => (signedIn ? m.open && onOpen(m.open) : onSignIn())}>
              <span className="rewardIcon">{m.icon}</span>
              <span className="rewardCopy">
                <b>{m.title}</b>
                <small>{signedIn ? [m.hint, amount(m.key)].filter(Boolean).join(" · ") : m.hint}</small>
              </span>
              <ChevronRight className="rewardChevron" size={18} />
            </button>
          );
        })}
        {feedbackDone ? (
          <div className="rewardItem completed">
            <span className="rewardIcon">
              <MessageSquare />
            </span>
            <span className="rewardCopy">
              <b>Share your experience</b>
              <small>Completed — thank you</small>
            </span>
            <span className="rewardState">
              <Check size={18} aria-label="Completed" />
            </span>
          </div>
        ) : (
          <button className="rewardItem actionable" type="button" onClick={() => (signedIn ? setFeedbackOpen(true) : onSignIn())}>
            <span className="rewardIcon">
              <MessageSquare />
            </span>
            <span className="rewardCopy">
              <b>Share your experience</b>
              <small>{signedIn ? ["Any honest feedback", amount("product_feedback") && amount("product_feedback") + " once"].filter(Boolean).join(" · ") : "Any honest feedback"}</small>
            </span>
            <ChevronRight className="rewardChevron" size={18} />
          </button>
        )}
        <button className="rewardItem actionable" type="button" onClick={signedIn ? onInvite : onSignIn}>
          <span className="rewardIcon">
            <Gift />
          </span>
          <span className="rewardCopy">
            <b>Invite a friend</b>
            <small>
              {signedIn
                ? [`When they sign up and complete their first scan`, amount("referral_qualified"), referrals ? `${referrals} rewarded` : ""].filter(Boolean).join(" · ")
                : "When they sign up and complete their first scan"}
            </small>
          </span>
          <ChevronRight className="rewardChevron" size={18} />
        </button>
      </div>
      {feedbackOpen && (
        <div className="plannerOverlay" onClick={() => setFeedbackOpen(false)}>
          <section className="plannerSheet compact feedbackSheet" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onClick={(e) => e.stopPropagation()}>
            <div className="sheetTop">
              <div>
                <h2 id="feedback-title">Share your experience</h2>
                <span className="sheetHint">Positive or negative — honest feedback earns the same reward.</span>
              </div>
              <button className="iconButton" onClick={() => setFeedbackOpen(false)} aria-label="Close">
                <X />
              </button>
            </div>
            <div className="feedbackStars" role="radiogroup" aria-label="Optional rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} className={rating && n <= rating ? "active" : ""} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => setRating(rating === n ? null : n)}>
                  <Star />
                </button>
              ))}
            </div>
            <label>
              <span>Tell us what you think (optional)</span>
              <textarea rows={5} maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What works well? What should we improve?" />
            </label>
            <p className="feedbackPolicy">Credits are for submitting feedback, not for giving a positive rating. Add a rating or a few words.</p>
            <button className="button sheetSave" disabled={sending || (!rating && !feedback.trim())} onClick={submitFeedback}>
              {sending ? "Sending…" : amount("product_feedback") ? `Send feedback · ${amount("product_feedback")}` : "Send feedback"}
            </button>
          </section>
        </div>
      )}
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
