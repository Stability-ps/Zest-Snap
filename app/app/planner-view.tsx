"use client";
import { MAX_DATE, MIN_DATE } from "@/lib/dates";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  monthGrid,
  plannerReferenceDate,
  plannerReferenceTime,
  plannerSort,
  plannerStatus,
  isPastLocal,
  todayDate,
  mergePlannerWithExternal,
  type PlannerItem,
  type PlannerItemType,
  type ReminderDraft,
  type ReminderPreset,
} from "@/lib/planner";
import { sharedPlannerStore, subscribePlanner, type PlannerStore } from "@/lib/planner-store";
import {
  cancelReminder,
  createReminder,
  enablePushNotifications,
  getNotificationState,
  listReminders,
  markReminderHandled,
  snoozeReminder,
  type NotificationState,
  type ReminderRecord,
} from "@/lib/reminders";
import { addPlannerItemToDevice, deviceCalendarAvailable } from "@/lib/native/calendar";
import { hapticSuccess } from "@/lib/native/haptics";
import { isNative } from "@/lib/native/runtime";
import { openAppSettings } from "@/lib/native/permissions";
import PlanningTools from "./planning-tools";
import SmartFollowups from "./smart-followups";

type Tab = "today" | "upcoming" | "calendar" | "reminders";
type ReminderFilter = "all" | "today" | "upcoming" | "overdue";
export type PlannerRequest = {
  tab?: Tab;
  nonce: number;
  reminderAction?: "snooze" | "done";
  reminderId?: string;
};
type Props = {
  identity: string;
  timezone: string;
  locale: string;
  signedIn: boolean;
  request?: PlannerRequest;
  onNotice?: (kind: "success" | "error", message: string) => void;
  onSignIn?: () => void;
};

function emptyItem(timezone: string, date = todayDate(timezone)): PlannerItem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type: "event",
    title: "",
    description: "",
    startDate: date,
    endDate: date,
    startTime: "",
    endTime: "",
    dueDate: date,
    dueTime: "",
    allDay: true,
    timezone,
    location: "",
    status: "open",
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}
const dateKeyIn = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).format(new Date(iso));

export default function PlannerView({ identity, timezone, locale, signedIn, request, onNotice, onSignIn }: Props) {
  const [store, setStore] = useState<PlannerStore | null>(null);
  const [items, setItems] = useState<PlannerItem[]>([]);
  const [googleItems, setGoogleItems] = useState<PlannerItem[]>([]);
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [tab, setTab] = useState<Tab>(request?.tab || "today");
  const [selectedDate, setSelectedDate] = useState(() => todayDate(timezone));
  const [month, setMonth] = useState(() => {
    const [y, m] = todayDate(timezone).split("-").map(Number);
    return { year: y, month: m };
  });
  const [editing, setEditing] = useState<PlannerItem | null>(null);
  const [reminderItem, setReminderItem] = useState<PlannerItem | null>(null);
  const [newReminderDate, setNewReminderDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [daySheet, setDaySheet] = useState(false);
  const [notificationState, setNotificationState] = useState<NotificationState>("available");
  const [reminderFilter, setReminderFilter] = useState<ReminderFilter>("all");
  const noticeRef = useRef(onNotice);
  useEffect(() => {
    noticeRef.current = onNotice;
  }, [onNotice]);
  const notice = useCallback((k: "success" | "error", m: string) => noticeRef.current?.(k, m), []);

  const refreshReminders = useCallback(async () => {
    const [r, n] = await Promise.all([listReminders().catch(() => null), getNotificationState()]);
    if (r) setReminders(r);
    setNotificationState(n);
  }, []);

  // Shared store: Home and Planner render the same items and update together.
  useEffect(() => {
    let alive = true;
    const unsubscribe = subscribePlanner((next) => alive && setItems(next));
    sharedPlannerStore(identity)
      .then(async (s) => {
        if (!alive) return;
        setStore(s);
        setItems(s.loadCached());
        await s.load().catch((e) => notice("error", e instanceof Error ? e.message : "Planner could not sync."));
      })
      .catch(() => notice("error", "Planner could not be loaded."));
    refreshReminders();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [identity, notice, refreshReminders]);

  // Returning from Android notification settings or the background must show the real state.
  useEffect(() => {
    const onChange = () => refreshReminders();
    const onVisible = () => document.visibilityState === "visible" && refreshReminders();
    window.addEventListener("zest-reminders-changed", onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("zest-reminders-changed", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshReminders]);

  // Navigation requests from Home, Review, notifications and deep links.
  const handled = useRef(0);
  useEffect(() => {
    if (!request || handled.current === request.nonce) return;
    handled.current = request.nonce;
    if (request.tab) setTab(request.tab);
    if (request.reminderAction && request.reminderId) {
      const run = request.reminderAction === "snooze" ? snoozeReminder(request.reminderId, 15) : markReminderHandled(request.reminderId);
      run
        .then(() => notice("success", request.reminderAction === "snooze" ? "Reminder snoozed for 15 minutes." : "Reminder marked as done."))
        .catch((e) => notice("error", e instanceof Error ? e.message : "Reminder could not be updated."))
        .finally(refreshReminders);
    }
  }, [request, notice, refreshReminders]);

  const refreshGoogle = useCallback(async () => {
    if (!signedIn || !navigator.onLine) return setGoogleItems([]);
    const now = new Date();
    const min = new Date(now.getTime() - 62 * 86400000).toISOString();
    const max = new Date(now.getTime() + 305 * 86400000).toISOString();
    try {
      const response = await fetch(`/api/calendar/google/events?timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}&timezone=${encodeURIComponent(timezone)}`, { cache: "no-store" });
      if (response.status === 409) return setGoogleItems([]);
      if (response.status === 401) {
        setGoogleItems([]);
        notice("error", "Google Calendar needs to be reconnected in Settings.");
        return;
      }
      if (!response.ok) throw new Error("calendar_sync_failed");
      const body = await response.json();
      setGoogleItems(Array.isArray(body.events) ? body.events : []);
    } catch {
      // Keep the last successful overlay on transient failures; Planner's own data remains available.
    }
  }, [signedIn, timezone, notice]);

  useEffect(() => {
    if (signedIn && navigator.onLine) {
      const key = "zest-google-planner-backfill-v1";
      if (localStorage.getItem(key) !== "done") {
        fetch("/api/calendar/google/events", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timezone }),
        }).then(async (response) => {
          if (response.ok) {
            const result = await response.json();
            if (!result.failed) localStorage.setItem(key, "done");
            refreshGoogle();
          }
        }).catch(() => undefined);
      }
    }
  }, [signedIn, timezone, refreshGoogle]);

  useEffect(() => {
    refreshGoogle();
    const onVisible = () => document.visibilityState === "visible" && refreshGoogle();
    const onOnline = () => refreshGoogle();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(refreshGoogle, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [refreshGoogle]);

  const today = todayDate(timezone);
  const mergedItems = useMemo(() => mergePlannerWithExternal(items, googleItems), [items, googleItems]);
  const live = useMemo(() => mergedItems.filter((x) => x.status !== "cancelled"), [mergedItems]);
  const visible = useMemo(() => {
    const filtered =
      tab === "today"
        ? live.filter((x) => plannerReferenceDate(x) === today)
        : tab === "upcoming"
          ? live.filter((x) => ["today", "upcoming"].includes(plannerStatus(x, undefined, timezone)))
          : tab === "calendar"
            ? live.filter((x) => plannerReferenceDate(x) === selectedDate)
            : [];
    return plannerSort(filtered);
  }, [live, tab, today, selectedDate, timezone]);
  const calendar = useMemo(() => monthGrid(month.year, month.month, locale, timezone), [month, locale, timezone]);
  const marked = useMemo(() => new Set(live.map(plannerReferenceDate)), [live]);
  const activeReminders = useMemo(() => reminders.filter((r) => r.status !== "cancelled" && r.status !== "handled"), [reminders]);
  const reminderMarked = useMemo(() => new Set(activeReminders.map((r) => dateKeyIn(r.scheduledAt, timezone))), [activeReminders, timezone]);
  // A standalone reminder is shown once, as its reminder row, not again as its hidden Planner entry.
  const remindedIds = useMemo(() => new Set(activeReminders.map((r) => r.plannerItemId)), [activeReminders]);
  const selectedDayItems = useMemo(
    () => live.filter((x) => plannerReferenceDate(x) === selectedDate && !(x.type === "reminder" && remindedIds.has(x.id))),
    [live, selectedDate, remindedIds],
  );
  const selectedDayReminders = useMemo(
    () => activeReminders.filter((r) => dateKeyIn(r.scheduledAt, timezone) === selectedDate),
    [activeReminders, selectedDate, timezone],
  );
  const pendingCount = activeReminders.filter((r) => r.status === "pending" || r.status === "sent" || r.status === "processing").length;

  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notice("error", e instanceof Error ? e.message : "Planner action failed.");
    } finally {
      setBusy(false);
    }
  };
  const reminderSaved = (background: boolean) =>
    notice(
      "success",
      background
        ? notificationState === "enabled"
          ? "Reminder scheduled."
          : "Reminder scheduled. Turn on notifications in Reminders to be alerted on this device."
        : "Reminder saved in Zest. Sign in to get phone notifications.",
    );
  const formatDate = (date: string, style: "medium" | "long" = "medium") =>
    new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
  const formatTime = (time: string) =>
    new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "UTC" }).format(new Date(`1970-01-01T${time}:00Z`));

  return (
    <section className="plannerRoot">
      <div className="plannerHero">
        <div>
          <h1>Your planner</h1>
          <p>Events, tasks and deadlines — organised in Zest.</p>
        </div>
        <div className="plannerHeroActions">
          <button
            className={`plannerReminderButton ${tab === "reminders" ? "active" : ""}`}
            onClick={() => setTab("reminders")}
            aria-label={pendingCount ? `Open reminders, ${pendingCount} active` : "Open reminders"}
            aria-pressed={tab === "reminders"}
          >
            <Bell />
            {pendingCount > 0 && <span aria-hidden="true">{pendingCount}</span>}
          </button>
          <button className="plannerFab" onClick={() => setEditing(emptyItem(timezone, tab === "calendar" ? selectedDate : today))} aria-label="Add to Planner">
            <Plus />
          </button>
        </div>
      </div>
      {tab !== "reminders" && (
        <div className="plannerTabs" role="tablist" aria-label="Planner views">
          {(["today", "upcoming", "calendar"] as Tab[]).map((v) => (
            <button role="tab" aria-selected={tab === v} key={v} className={tab === v ? "active" : ""} onClick={() => setTab(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      )}
      {tab === "calendar" && (
        <div className="plannerCalendar">
          <div className="calendarTop">
            <button
              onClick={() => setMonth((m) => (m.month === 1 ? { year: m.year - 1, month: 12 } : { year: m.year, month: m.month - 1 }))}
              aria-label="Previous month"
            >
              <ChevronLeft />
            </button>
            <strong aria-live="polite">
              {new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(month.year, month.month - 1, 15)))}
            </strong>
            <button
              onClick={() => setMonth((m) => (m.month === 12 ? { year: m.year + 1, month: 1 } : { year: m.year, month: m.month + 1 }))}
              aria-label="Next month"
            >
              <ChevronRight />
            </button>
          </div>
          <button
            className="todayShortcut"
            onClick={() => {
              const [y, m] = today.split("-").map(Number);
              setMonth({ year: y, month: m });
              setSelectedDate(today);
            }}
          >
            Today
          </button>
          <div className="weekdayRow" aria-hidden="true">
            {calendar.weekdayLabels.map((x, i) => (
              <span key={i}>{x}</span>
            ))}
          </div>
          <div className="monthGrid">
            {calendar.cells.map((c) => (
              <button
                key={c.date}
                className={`${c.inMonth ? "" : "outside"} ${selectedDate === c.date ? "selected" : ""}`}
                aria-label={formatDate(c.date, "long") + (marked.has(c.date) ? ", has plans" : "") + (reminderMarked.has(c.date) ? ", has reminders" : "")}
                aria-pressed={selectedDate === c.date}
                onClick={() => {
                  setSelectedDate(c.date);
                  setDaySheet(true);
                }}
              >
                <span>{Number(c.date.slice(-2))}</span>
                {marked.has(c.date) && <i className="plannerDot" />}
                {reminderMarked.has(c.date) && (
                  <i className="reminderDot">
                    <Bell />
                  </i>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      {tab !== "reminders" && (
        <div className="plannerList">
          {!visible.length && (
            <div className="plannerEmpty plannerEmptyCompact">
              <CalendarDays />
              <b>{tab === "today" ? "Nothing planned for today" : tab === "calendar" ? "Nothing on this day" : "No upcoming items"}</b>
              <span>Use the + button above to add something.</span>
            </div>
          )}
          {visible.map((item) => {
            const status = plannerStatus(item, undefined, timezone);
            const time = plannerReferenceTime(item);
            const itemReminders = activeReminders.filter((r) => r.plannerItemId === item.id).length;
            return (
              <article
                className={`plannerCard ${status}`}
                key={item.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${item.title}`}
                onClick={() => item.externalProvider === "google" ? (item.externalUrl ? window.open(item.externalUrl, "_blank", "noopener,noreferrer") : undefined) : setEditing(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (item.externalProvider === "google") {
                      if (item.externalUrl) window.open(item.externalUrl, "_blank", "noopener,noreferrer");
                    } else setEditing(item);
                  }
                }}
              >
                {(item.type === "task" || item.type === "deadline") && (
                  <button
                    className="completeButton"
                    aria-pressed={item.status === "completed"}
                    aria-label={item.status === "completed" ? `Mark ${item.title} as not done` : `Mark ${item.title} as done`}
                    onClick={(e) => { e.stopPropagation(); act(() => store!.setCompleted(item.id, item.status !== "completed").then(() => { if (item.status !== "completed") hapticSuccess(); })); }}
                  >
                    {item.status === "completed" ? <CheckCircle2 /> : <Check />}
                  </button>
                )}
                <div className="plannerCardBody">
                  <div className="plannerCardTop">
                    <span>{item.type}</span>
                    <em>{status === "open" ? "" : status}</em>
                  </div>
                  <h3>{item.title}</h3>
                  <p>
                    <Clock3 aria-hidden="true" /> {formatDate(plannerReferenceDate(item))}
                    {time ? ` · ${formatTime(time)}` : " · All day"}
                    {item.location ? ` · ${item.location}` : ""}
                  </p>
                  {item.externalProvider === "google" ? (
                    <div className="plannerCardActions"><span>Google Calendar</span></div>
                  ) : <div className="plannerCardActions">
                    {item.type !== "reminder" && (
                      <button onClick={(e) => { e.stopPropagation(); setReminderItem(item); }} aria-label={`Add reminder for ${item.title}`}>
                        <Bell /> {itemReminders ? `Reminder · ${itemReminders}` : "Reminder"}
                      </button>
                    )}
                    {/* Native apps only; hidden when the item already lives in Google Calendar (synced or imported), so nothing is duplicated. */}
                    {deviceCalendarAvailable() && item.status !== "cancelled" && !item.googleEventId && item.externalProvider !== "google" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          act(async () => {
                            if ((await addPlannerItemToDevice(item)) === "added") {
                              hapticSuccess();
                              notice("success", "Sent to your calendar.");
                            }
                          });
                        }}
                        aria-label={`Add ${item.title} to your calendar`}
                      >
                        <CalendarDays /> Calendar
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setEditing(item); }} aria-label={`Edit ${item.title}`}>
                      <Pencil /> Edit
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); act(() => store!.remove(item.id)); }} aria-label={`Delete ${item.title}`}>
                      <Trash2 /> Delete
                    </button>
                  </div>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {tab === "reminders" && (
        <RemindersPage
          reminders={activeReminders}
          items={items}
          locale={locale}
          timezone={timezone}
          filter={reminderFilter}
          setFilter={setReminderFilter}
          notificationState={notificationState}
          signedIn={signedIn}
          busy={busy}
          onBack={() => setTab("today")}
          onAdd={() => setNewReminderDate(today)}
          onSignIn={onSignIn}
          onEnable={() =>
            act(async () => {
              try {
                await enablePushNotifications();
                notice("success", "Notifications are on for this device.");
              } finally {
                setNotificationState(await getNotificationState());
              }
            })
          }
          onEdit={(item) => setEditing(item)}
          onHandled={(id) => act(() => markReminderHandled(id))}
          onSnooze={(id, minutes) => act(() => snoozeReminder(id, minutes).then(() => notice("success", "Reminder snoozed.")))}
          onCancel={(id) => act(() => cancelReminder(id))}
        />
      )}
      {tab !== "reminders" && <SmartFollowups signedIn={signedIn} items={items} onNotice={onNotice} />}
      {tab !== "reminders" && <PlanningTools identity={identity} timezone={timezone} signedIn={signedIn} onNotice={onNotice} />}
      {daySheet && (
        <Sheet label={formatDate(selectedDate, "long")} onClose={() => setDaySheet(false)} className="compact calendarActionSheet">
          <div className="sheetTop">
            <div>
              <h2>{formatDate(selectedDate, "long")}</h2>
              <span className="sheetHint">
                {selectedDayItems.length + selectedDayReminders.length ? `${selectedDayItems.length + selectedDayReminders.length} scheduled` : "Nothing planned yet"}
              </span>
            </div>
            <button className="iconButton" onClick={() => setDaySheet(false)} aria-label="Close">
              <X />
            </button>
          </div>
          {selectedDayItems.length + selectedDayReminders.length > 0 && (
            <div className="calendarDayPreview">
              <div className="calendarDayPreviewHead">
                <b>On this day</b>
              </div>
              {selectedDayItems.slice(0, 3).map((item) => (
                <button
                  className="calendarDayRow"
                  key={item.id}
                  onClick={() => {
                    setDaySheet(false);
                    setEditing(item);
                  }}
                >
                  <CalendarDays />
                  <span>
                    <b>{item.title}</b>
                    <small>{plannerReferenceTime(item) ? formatTime(plannerReferenceTime(item)) : "All day"}</small>
                  </span>
                  <ChevronRight />
                </button>
              ))}
              {selectedDayReminders.slice(0, 3).map((r) => (
                <button
                  className="calendarDayRow reminder"
                  key={r.id}
                  onClick={() => {
                    setDaySheet(false);
                    setTab("reminders");
                  }}
                >
                  <Bell />
                  <span>
                    <b>{items.find((i) => i.id === r.plannerItemId)?.title || r.label || "Reminder"}</b>
                    <small>{new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: timezone }).format(new Date(r.scheduledAt))}</small>
                  </span>
                  <ChevronRight />
                </button>
              ))}
            </div>
          )}
          <div className="calendarActionChoices">
            <button
              onClick={() => {
                setDaySheet(false);
                setEditing(emptyItem(timezone, selectedDate));
              }}
            >
              <CalendarDays />
              <b>Plan something</b>
              <span>Add an event, task or deadline.</span>
            </button>
            <button
              onClick={() => {
                setDaySheet(false);
                setNewReminderDate(selectedDate);
              }}
            >
              <Bell />
              <b>Set a reminder</b>
              <span>Choose a time and get notified.</span>
            </button>
            <button className="calendarViewDay" onClick={() => setDaySheet(false)}>
              <ListChecks />
              <b>View day</b>
              <span>See everything on this date.</span>
            </button>
          </div>
        </Sheet>
      )}
      {editing && (
        <Editor
          item={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(i, d) =>
            act(async () => {
              await store!.upsert(i);
              setEditing(null);
              if (d) {
                const r = await createReminder(i, d, i.title);
                reminderSaved(r.backgroundDelivery);
              } else notice("success", "Saved to Planner.");
            })
          }
        />
      )}
      {newReminderDate && (
        <NewReminder
          date={newReminderDate}
          timezone={timezone}
          busy={busy}
          onClose={() => setNewReminderDate(null)}
          onSave={(title, date, time) =>
            act(async () => {
              // A standalone reminder is stored as a hidden Planner entry so it syncs, appears on the
              // calendar and is delivered by the same push pipeline.
              const item: PlannerItem = { ...emptyItem(timezone, date), type: "reminder", title, allDay: false, startTime: time };
              await store!.upsert(item);
              const r = await createReminder(item, { preset: "at_time" }, title);
              setNewReminderDate(null);
              reminderSaved(r.backgroundDelivery);
            })
          }
        />
      )}
      {reminderItem && (
        <Reminder
          item={reminderItem}
          busy={busy}
          onClose={() => setReminderItem(null)}
          onSave={(d) =>
            act(async () => {
              const r = await createReminder(reminderItem, d, reminderItem.title);
              setReminderItem(null);
              reminderSaved(r.backgroundDelivery);
            })
          }
        />
      )}
    </section>
  );
}

/** Bottom sheet with dialog semantics, Escape to close and focus kept inside. */
function Sheet({ label, onClose, className = "", children }: { label: string; onClose: () => void; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([aria-label='Close'])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !ref.current) return;
      const focusable = [...ref.current.querySelectorAll<HTMLElement>("button,input,select,textarea,[href]")].filter((el) => !el.hasAttribute("disabled"));
      if (!focusable.length) return;
      const [a, z] = [focusable[0], focusable[focusable.length - 1]];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="plannerOverlay" onClick={onClose}>
      <section ref={ref} className={`plannerSheet ${className}`} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </section>
    </div>
  );
}

function RemindersPage({
  reminders,
  items,
  locale,
  timezone,
  filter,
  setFilter,
  notificationState,
  signedIn,
  busy,
  onBack,
  onAdd,
  onSignIn,
  onEnable,
  onEdit,
  onHandled,
  onSnooze,
  onCancel,
}: {
  reminders: ReminderRecord[];
  items: PlannerItem[];
  locale: string;
  timezone: string;
  filter: ReminderFilter;
  setFilter: (v: ReminderFilter) => void;
  notificationState: NotificationState;
  signedIn: boolean;
  busy: boolean;
  onBack: () => void;
  onAdd: () => void;
  onSignIn?: () => void;
  onEnable: () => void;
  onEdit: (item: PlannerItem) => void;
  onHandled: (id: string) => void;
  onSnooze: (id: string, minutes: number) => void;
  onCancel: (id: string) => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.type === "pointerdown" && (e.target as HTMLElement).closest(".reminderCardMenu")) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);
  const today = todayDate(timezone),
    itemFor = (r: ReminderRecord) => items.find((i) => i.id === r.plannerItemId);
  const dateKey = (r: ReminderRecord) => dateKeyIn(r.scheduledAt, timezone);
  const overdue = (r: ReminderRecord) => Date.parse(r.scheduledAt) < now;
  const filtered = reminders.filter(
    (r) =>
      filter === "all" ||
      (filter === "today" && dateKey(r) === today) ||
      (filter === "upcoming" && !overdue(r) && dateKey(r) !== today) ||
      (filter === "overdue" && overdue(r)),
  );
  const groups: [string, ReminderRecord[]][] = [
    ["Overdue", filtered.filter((r) => overdue(r))],
    ["Today", filtered.filter((r) => !overdue(r) && dateKey(r) === today)],
    ["Upcoming", filtered.filter((r) => !overdue(r) && dateKey(r) !== today)],
  ];
  const row = (r: ReminderRecord) => {
    const item = itemFor(r),
      title = item?.title || r.label || "Reminder",
      when = new Intl.DateTimeFormat(locale, {
        dateStyle: dateKey(r) === today ? undefined : "medium",
        timeStyle: "short",
        timeZone: timezone,
      }).format(new Date(r.scheduledAt));
    return (
      <article className="reminderCard" key={r.id}>
        <div className="reminderCardIcon" aria-hidden="true">
          <Bell />
        </div>
        <div className="reminderCardCopy">
          <b>{title}</b>
          <span>
            <CalendarDays aria-hidden="true" /> {dateKey(r) === today ? "Today, " : ""}
            {when}
          </span>
          <span>
            <Clock3 aria-hidden="true" />{" "}
            {r.status === "sent" ? "Delivered" : r.status === "failed" ? "Couldn’t be delivered" : r.offsetMinutes === 0 ? "At time" : r.offsetMinutes ? formatOffset(r.offsetMinutes) + " before" : "Scheduled"}
          </span>
        </div>
        <div className="reminderCardMenu">
          <button onClick={() => setMenu(menu === r.id ? null : r.id)} disabled={busy} aria-label={`Options for ${title}`} aria-haspopup="menu" aria-expanded={menu === r.id}>
            •••
          </button>
          <button className="reminderCheck" onClick={() => onHandled(r.id)} disabled={busy} aria-label={`Mark ${title} as done`}>
            <Check />
          </button>
          {menu === r.id && (
            <div className="reminderMenuPopover" role="menu">
              {(
                [
                  ["Snooze 15 min", () => onSnooze(r.id, 15)],
                  ["Snooze 1 hour", () => onSnooze(r.id, 60)],
                  ["Mark as done", () => onHandled(r.id)],
                  ...(item && item.type !== "reminder" ? ([["Edit item", () => onEdit(item)]] as const) : []),
                ] as const
              ).map(([label, fn]) => (
                <button
                  key={label}
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    fn();
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  setMenu(null);
                  onCancel(r.id);
                }}
              >
                Cancel reminder
              </button>
            </div>
          )}
        </div>
      </article>
    );
  };
  return (
    <div className="remindersStandalone">
      <div className="remindersTitle">
        <button className="reminderBack" onClick={onBack} aria-label="Back to Planner">
          <ChevronLeft />
        </button>
        <div className="remindersTitleCopy">
          <h2>Reminders</h2>
          <p>Stay ahead of what matters</p>
        </div>
        <button className="reminderAddButton" onClick={onAdd} disabled={busy} aria-label="Add reminder">
          <Plus />
          <span>Add</span>
        </button>
      </div>
      <div className={"notificationStatus " + (signedIn ? notificationState : "available")} role="status">
        <Bell aria-hidden="true" />
        <div>
          <b>
            {!signedIn
              ? "Notifications need an account"
              : notificationState === "enabled"
                ? "Notifications on"
                : notificationState === "blocked"
                  ? "Notifications blocked"
                  : notificationState === "unsupported"
                    ? "Notifications unavailable"
                    : "Turn on notifications"}
          </b>
          <span>
            {!signedIn
              ? "Sign in so Zest can alert you even when the app is closed."
              : notificationState === "enabled"
                ? "Zest can alert you on this device. Sound and vibration follow your phone settings."
                : notificationState === "blocked"
                  ? "Allow notifications for Zest Snap in your phone or browser settings, then come back."
                  : notificationState === "unsupported"
                    ? "This browser can’t show background reminders. Install Zest Snap or use Chrome."
                    : "Get reminders even when Zest isn’t open."}
          </span>
        </div>
        {!signedIn && onSignIn && (
          <button className="button alt" onClick={onSignIn}>
            Sign in
          </button>
        )}
        {signedIn && notificationState === "blocked" && isNative() && (
          <button className="button alt" onClick={() => openAppSettings()}>
            Open Settings
          </button>
        )}
        {signedIn && notificationState === "available" && (
          <button className="button alt" onClick={onEnable} disabled={busy}>
            Enable
          </button>
        )}
        {signedIn && notificationState === "enabled" && <CheckCircle2 aria-hidden="true" />}
      </div>
      <div className="reminderFilters" role="tablist" aria-label="Filter reminders">
        {(["all", "today", "upcoming", "overdue"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={filter === v} className={filter === v ? "active" : ""} onClick={() => setFilter(v)}>
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      {!filtered.length ? (
        <div className="plannerEmpty reminderEmpty">
          <Bell aria-hidden="true" />
          <b>{filter === "all" ? "No reminders yet" : `No ${filter} reminders`}</b>
          <span>{filter === "all" ? "Add one here, or tap a day in Calendar to set a reminder." : "You’re all caught up."}</span>
          {filter === "all" && (
            <button className="button alt" onClick={onAdd}>
              Add a reminder
            </button>
          )}
        </div>
      ) : (
        groups
          .filter(([, rows]) => rows.length)
          .map(([name, rows]) => (
            <section className="reminderGroup" key={name}>
              <h3>
                {name} <span>{rows.length}</span>
              </h3>
              {rows.map(row)}
            </section>
          ))
      )}
    </div>
  );
}

function formatOffset(minutes: number) {
  if (minutes % 10080 === 0) return `${minutes / 10080} week${minutes === 10080 ? "" : "s"}`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} min`;
}

function Editor({ item, busy, onClose, onSave }: { item: PlannerItem; busy: boolean; onClose: () => void; onSave: (i: PlannerItem, d?: ReminderDraft) => void }) {
  const [d, setD] = useState(item),
    [reminder, setReminder] = useState<"none" | ReminderPreset>("none"),
    [reminderOpen, setReminderOpen] = useState(false),
    [notesOpen, setNotesOpen] = useState(Boolean(item.description)),
    task = d.type === "task" || d.type === "deadline",
    patch = (p: Partial<PlannerItem>) => setD({ ...d, ...p, updatedAt: new Date().toISOString() });
  const time = task ? d.dueTime : d.startTime,
    setTime = (v: string) => patch(task ? { dueTime: v } : { startTime: v });
  // Legacy items may have been created while the app still defaulted to UTC.
  // For editing, use the current Planner timezone unless the item has a real non-UTC zone.
  const effectiveTimezone = d.timezone && d.timezone !== "UTC" ? d.timezone : item.timezone && item.timezone !== "UTC" ? item.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const tz = effectiveTimezone.replace(/_/g, " ");
  const reminderLabels: Record<string, string> = {
    none: "None",
    at_time: "At time",
    "5m": "5 min before",
    "15m": "15 min before",
    "30m": "30 min before",
    "1h": "1 hour before",
    "1d": "1 day before",
  };
  const isNew = !item.title;
  return (
    <Sheet label={isNew ? "Add to Planner" : "Edit item"} onClose={onClose} className="plannerEditorV2">
      <div className="sheetTop">
        <h2>{isNew ? "Add to Planner" : "Edit item"}</h2>
        <button className="iconButton compactClose" onClick={onClose} aria-label="Close">
          <X />
        </button>
      </div>
      {d.type !== "reminder" && (
        <div className="plannerKinds compactKinds" role="radiogroup" aria-label="Item type">
          {(["event", "task", "deadline"] as PlannerItemType[]).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={d.type === t}
              className={d.type === t ? "active" : ""}
              onClick={() => {
                const toTask = t === "task" || t === "deadline";
                const date = (task ? d.dueDate : d.startDate) || d.dueDate || d.startDate;
                patch({
                  type: t,
                  startDate: toTask ? "" : date,
                  endDate: toTask ? "" : date,
                  dueDate: toTask ? date : "",
                  startTime: toTask ? "" : time,
                  dueTime: toTask ? time : "",
                });
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <label className="compactLabel">
        <span>Title</span>
        <input value={d.title} maxLength={500} onChange={(e) => patch({ title: e.target.value })} placeholder={task ? "What needs to be done?" : "What are you planning?"} />
      </label>
      <div className="dateTimeRow">
        <label>
          <span>{task ? "Due date" : "Date"}</span>
          <input
            type="date" min={MIN_DATE} max={MAX_DATE}
            value={task ? d.dueDate : d.startDate}
            onChange={(e) =>
              patch(task ? { dueDate: e.target.value } : { startDate: e.target.value, endDate: !d.endDate || d.endDate < e.target.value ? e.target.value : d.endDate })
            }
          />
        </label>
        {!d.allDay && (
          <label className="timeField">
            <span>Time</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        )}
      </div>
      <div className="plannerInlineMeta">
        <label className="switchRow">
          <input type="checkbox" checked={d.allDay} onChange={(e) => patch({ allDay: e.target.checked, ...(e.target.checked ? { startTime: "", dueTime: "", endTime: "" } : {}) })} />
          <span>All day</span>
        </label>
        <span className="localTime">Local time · {tz}</span>
      </div>
      <label className="compactLabel">
        <span>
          Location <small>optional</small>
        </span>
        <input value={d.location} maxLength={2000} onChange={(e) => patch({ location: e.target.value })} placeholder="Add a place" />
      </label>
      <button type="button" className="plannerChoiceRow" onClick={() => setReminderOpen(true)} aria-haspopup="dialog">
        <span>
          <Bell size={20} aria-hidden="true" />
          <span>
            <b>Reminder</b>
            <small>Phone notification</small>
          </span>
        </span>
        <strong>
          {reminderLabels[reminder]} <ChevronRight size={18} aria-hidden="true" />
        </strong>
      </button>
      {!notesOpen ? (
        <button type="button" className="addNotes" onClick={() => setNotesOpen(true)}>
          + Add notes
        </button>
      ) : (
        <label className="compactLabel">
          <span>
            Notes <small>optional</small>
          </span>
          <textarea rows={3} maxLength={10000} value={d.description} onChange={(e) => patch({ description: e.target.value })} />
        </label>
      )}
      <button className="button sheetSave stickySave" disabled={busy || !d.title.trim() || (!d.allDay && !time)} onClick={() => onSave({ ...d, timezone: effectiveTimezone }, reminder === "none" ? undefined : { preset: reminder })}>
        {busy ? "Saving…" : reminder === "none" ? "Save to Planner" : "Save with reminder"}
      </button>
      {!d.allDay && !time && <p className="sheetHint">Add a time, or switch on All day.</p>}
      {reminderOpen && (
        <div className="nestedSheetBackdrop" onClick={() => setReminderOpen(false)}>
          <div className="nestedSheet" role="dialog" aria-modal="true" aria-label="Remind me" onClick={(e) => e.stopPropagation()}>
            <div className="nestedSheetHandle" />
            <h3>Remind me</h3>
            {(["none", "at_time", "5m", "15m", "30m", "1h", "1d"] as const).map((v) => (
              <button
                key={v}
                className={reminder === v ? "selected" : ""}
                aria-pressed={reminder === v}
                onClick={() => {
                  setReminder(v);
                  setReminderOpen(false);
                }}
              >
                <span>{reminderLabels[v]}</span>
                {reminder === v && <Check size={20} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Dedicated reminder flow: what, which day (prefilled from Calendar) and what time. */
function NewReminder({
  date,
  timezone,
  busy,
  onClose,
  onSave,
}: {
  date: string;
  timezone: string;
  busy: boolean;
  onClose: () => void;
  onSave: (title: string, date: string, time: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(date);
  const [time, setTime] = useState(() => {
    const now = new Date(Date.now() + 60 * 60000);
    const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(now);
    return date === todayDate(timezone) ? parts.slice(0, 2) + ":00" : "09:00";
  });
  const past = isPastLocal(day, time, timezone);
  return (
    <Sheet label="New reminder" onClose={onClose} className="compact reminderSheet">
      <div className="sheetTop">
        <div>
          <h2>New reminder</h2>
          <span className="sheetHint">Zest will notify you at this time ({timezone.replace(/_/g, " ")}).</span>
        </div>
        <button className="iconButton" onClick={onClose} aria-label="Close">
          <X />
        </button>
      </div>
      <label className="reminderField">
        <span>Remind me to</span>
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call the school" />
      </label>
      <div className="customReminder">
        <label className="reminderField">
          <span>Date</span>
          <input type="date" min={MIN_DATE} max={MAX_DATE} value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="reminderField">
          <span>Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      {past && <p className="reminderError">That time has already passed — choose a later time.</p>}
      <button className="button sheetSave" disabled={busy || !title.trim() || !day || !time || past} onClick={() => onSave(title.trim(), day, time)}>
        {busy ? "Saving…" : "Save reminder"}
      </button>
    </Sheet>
  );
}

function Reminder({ item, busy, onClose, onSave }: { item: PlannerItem; busy: boolean; onClose: () => void; onSave: (d: ReminderDraft) => void }) {
  const [p, setP] = useState<ReminderDraft["preset"]>(item.type === "task" || item.type === "deadline" ? "1d" : "1h");
  const [custom, setCustom] = useState("");
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [time, setTime] = useState("09:00");
  const number = custom.trim() === "" ? NaN : Number(custom);
  const multiplier = unit === "days" ? 1440 : unit === "hours" ? 60 : 1;
  const customMinutes = Number.isFinite(number) ? Math.round(number * multiplier) : NaN;
  const customValid = p !== "custom" || (Number.isFinite(customMinutes) && customMinutes >= 0 && customMinutes <= 525600);
  const needsTime = !item.allDay && !plannerReferenceTime(item);
  return (
    <Sheet label="Reminder" onClose={onClose} className="compact reminderSheet">
      <div className="sheetTop">
        <div>
          <h2>Reminder</h2>
          <span className="sheetHint">Choose when Zest should remind you about “{item.title}”.</span>
        </div>
        <button className="iconButton" onClick={onClose} aria-label="Close">
          <X />
        </button>
      </div>
      <div className="reminderChoices" role="radiogroup" aria-label="When">
        {(
          [
            ["at_time", "At time"],
            ["5m", "5 min before"],
            ["15m", "15 min before"],
            ["30m", "30 min before"],
            ["1h", "1 hour before"],
            ["1d", "1 day before"],
            ["1w", "1 week before"],
            ["custom", "Custom"],
          ] as [ReminderDraft["preset"], string][]
        ).map(([v, l]) => (
          <button type="button" key={v} role="radio" aria-checked={p === v} className={p === v ? "active" : ""} onClick={() => setP(v)}>
            {l}
          </button>
        ))}
      </div>
      {item.allDay && (
        <label className="reminderField">
          <span>Reminder time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      )}
      {p === "custom" && (
        <div className="customReminder">
          <label className="reminderField">
            <span>How long before?</span>
            <input type="number" inputMode="decimal" min="0" step="1" value={custom} placeholder="Enter a number" onChange={(e) => setCustom(e.target.value)} />
          </label>
          <label className="reminderField">
            <span>Unit</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value as "minutes" | "hours" | "days")}>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </label>
        </div>
      )}
      {p === "custom" && !customValid && custom.trim() !== "" && <p className="reminderError">Choose a reminder between 0 minutes and 365 days.</p>}
      {needsTime && <p className="reminderError">Give this item a time (or make it all day) before adding a reminder.</p>}
      <button
        className="button sheetSave"
        disabled={busy || !customValid || needsTime}
        onClick={() => onSave({ preset: p, customMinutes: p === "custom" ? customMinutes : undefined, allDayTime: item.allDay ? time : undefined })}
      >
        Schedule reminder
      </button>
    </Sheet>
  );
}
