"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "./supabase/client";
import type { PlannerItem } from "./planner";
import { plannerFingerprint, validatePlannerItem } from "./planner";

const GUEST_KEY = "zest-planner-v1";
const LAST_USED_KEY = "zest-planner-last-used-v1";
const cloudKey = (u: string) => `zest-planner-cloud-${u}`;
type Pending = { op: "upsert"; item: PlannerItem } | { op: "delete"; id: string };
type Cache = { items: PlannerItem[]; pending: Pending[] };
const COLUMNS =
  "id,type,title,description,start_date,end_date,start_time,end_time,due_date,due_time,all_day,timezone,location,status,source,source_scan_id,completed_at,created_at,updated_at";

function parse(raw: string | null): Cache {
  if (!raw) return { items: [], pending: [] };
  try {
    const v = JSON.parse(raw);
    return { items: Array.isArray(v.items) ? v.items : [], pending: Array.isArray(v.pending) ? v.pending : [] };
  } catch {
    return { items: [], pending: [] };
  }
}
function row(r: Record<string, any>): PlannerItem {
  return {
    id: r.id, type: r.type, title: r.title, description: r.description || "",
    startDate: r.start_date || "", endDate: r.end_date || "",
    startTime: r.start_time ? String(r.start_time).slice(0, 5) : "", endTime: r.end_time ? String(r.end_time).slice(0, 5) : "",
    dueDate: r.due_date || "", dueTime: r.due_time ? String(r.due_time).slice(0, 5) : "",
    allDay: Boolean(r.all_day), timezone: r.timezone || "UTC", location: r.location || "",
    status: r.status, source: r.source, sourceScanId: r.source_scan_id || undefined, completedAt: r.completed_at || undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function dbRow(i: PlannerItem, u: string) {
  return {
    id: i.id, user_id: u, source_scan_id: i.sourceScanId || null, type: i.type, title: i.title, description: i.description,
    start_date: i.startDate || null, end_date: i.endDate || null, start_time: i.startTime || null, end_time: i.endTime || null,
    due_date: i.dueDate || null, due_time: i.dueTime || null, all_day: i.allDay, timezone: i.timezone, location: i.location,
    status: i.status, source: i.source,
  };
}
function merge(items: PlannerItem[]) {
  const ids = new Map<string, PlannerItem>(), fps = new Set<string>();
  for (const i of [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const f = plannerFingerprint(i);
    if (fps.has(f) && i.source !== "manual") continue;
    fps.add(f);
    ids.set(i.id, i);
  }
  return [...ids.values()];
}
// Pending offline changes win over the server copy until they are flushed.
function applyPending(items: PlannerItem[], pending: Pending[]) {
  let next = items;
  for (const p of pending)
    next = p.op === "upsert" ? [p.item, ...next.filter((x) => x.id !== p.item.id)] : next.filter((x) => x.id !== p.id);
  return next;
}

// Every PlannerStore writing to the same cache notifies all views (Home, Planner, other tabs).
type Listener = (items: PlannerItem[]) => void;
const listeners = new Set<Listener>();
let current: { key: string; items: PlannerItem[] } | null = null;
function emit(key: string, items: PlannerItem[]) {
  current = { key, items };
  listeners.forEach((l) => l(items));
}
export function subscribePlanner(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (current && e.key === current.key) emit(current.key, parse(e.newValue).items);
  });

export class PlannerStore {
  private constructor(
    readonly mode: "local" | "cloud",
    private storage: Storage,
    private db?: SupabaseClient,
    readonly userId?: string,
  ) {}
  static async create(storage = localStorage) {
    if (!isSupabaseConfigured()) return new PlannerStore("local", storage);
    const db = createClient(),
      s = await db.auth.getSession(),
      u = s.data.session?.user;
    if (!u) return new PlannerStore("local", storage);
    return new PlannerStore("cloud", storage, db, u.id);
  }
  private key() {
    return this.mode === "cloud" ? cloudKey(this.userId!) : GUEST_KEY;
  }
  private cache() {
    return parse(this.storage.getItem(this.key()));
  }
  private write(c: Cache) {
    const raw = JSON.stringify(c);
    this.storage.setItem(this.key(), raw);
    this.storage.setItem(LAST_USED_KEY, raw);
    emit(this.key(), c.items);
  }
  static loadLastUsed(storage = localStorage) {
    return parse(storage.getItem(LAST_USED_KEY)).items;
  }
  static guestItems(storage = localStorage) {
    return parse(storage.getItem(GUEST_KEY)).items;
  }
  loadCached() {
    return this.cache().items;
  }
  async load() {
    if (this.mode === "local" || !navigator.onLine) {
      const items = this.cache().items;
      emit(this.key(), items);
      return items;
    }
    try {
      await this.flush();
    } catch {
      // Keep going: unsynced edits stay queued and are re-applied over the server copy below.
    }
    const { data, error } = await this.db!.from("planner_items").select(COLUMNS).eq("user_id", this.userId!).order("updated_at", { ascending: false });
    if (error) throw new Error("Planner could not sync. Your saved items are still available.");
    const pending = this.cache().pending;
    const items = applyPending((data || []).map(row), pending);
    this.write({ items, pending });
    return items;
  }
  async upsert(item: PlannerItem) {
    validatePlannerItem(item);
    const c = this.cache();
    const previous = c.items;
    c.items = merge([item, ...c.items.filter((x) => x.id !== item.id)]);
    if (this.mode === "local") return this.write(c);
    if (!navigator.onLine) {
      c.pending = [...c.pending.filter((x) => !(x.op === "upsert" && x.item.id === item.id)), { op: "upsert", item }];
      return this.write(c);
    }
    this.write(c); // optimistic: every view updates immediately
    const { error } = await this.db!.from("planner_items").upsert(dbRow(item, this.userId!));
    if (error) {
      this.write({ ...this.cache(), items: previous });
      throw new Error("Planner item could not be saved. Check your connection and try again.");
    }
  }
  async remove(id: string) {
    const c = this.cache();
    const previous = c.items;
    c.items = c.items.filter((x) => x.id !== id);
    if (this.mode === "local") return this.write(c);
    if (!navigator.onLine) {
      c.pending = [...c.pending.filter((x) => !(x.op === "upsert" && x.item.id === id)), { op: "delete", id }];
      return this.write(c);
    }
    this.write(c);
    const { error } = await this.db!.from("planner_items").delete().eq("id", id).eq("user_id", this.userId!);
    if (error) {
      this.write({ ...this.cache(), items: previous });
      throw new Error("Planner item could not be deleted. Check your connection and try again.");
    }
  }
  async setCompleted(id: string, completed: boolean) {
    const item = this.cache().items.find((x) => x.id === id) || (await this.load()).find((x) => x.id === id);
    if (!item) throw new Error("Planner item was not found.");
    const next = {
      ...item,
      status: (completed ? "completed" : "open") as PlannerItem["status"],
      completedAt: completed ? new Date().toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    };
    await this.upsert(next);
    return next;
  }
  async flush() {
    if (this.mode !== "cloud" || !navigator.onLine) return;
    let c = this.cache();
    for (const p of [...c.pending]) {
      const q =
        p.op === "upsert"
          ? await this.db!.from("planner_items").upsert(dbRow(p.item, this.userId!))
          : await this.db!.from("planner_items").delete().eq("id", p.id).eq("user_id", this.userId!);
      if (q.error) throw new Error("Planner changes are waiting to sync.");
      c = this.cache();
      c.pending.shift();
      this.storage.setItem(this.key(), JSON.stringify(c));
    }
  }
  /** Moves this device's guest Planner into the signed-in account once, then clears the guest copy. */
  async migrateGuest() {
    if (this.mode !== "cloud") throw new Error("Sign in before merging guest Planner items.");
    const guest = parse(this.storage.getItem(GUEST_KEY)).items;
    if (!guest.length) return new Map<string, string>();
    const remote = await this.load(),
      existing = new Map(remote.map((r) => [plannerFingerprint(r), r.id]));
    const { data, error } = await this.db!.from("scans").select("id").eq("user_id", this.userId!);
    if (error) throw new Error("Guest Planner items could not be linked to cloud scan history.");
    const ids = new Set((data || []).map((x) => x.id));
    const moved = new Map<string, string>();
    for (const i of guest) {
      const duplicate = existing.get(plannerFingerprint(i));
      if (duplicate) {
        moved.set(i.id, duplicate);
        continue;
      }
      const linked = Boolean(i.sourceScanId && ids.has(i.sourceScanId));
      await this.upsert({ ...i, source: linked && i.source === "scan" ? "scan" : i.source === "manual" ? "manual" : "import", sourceScanId: linked ? i.sourceScanId : undefined, updatedAt: new Date().toISOString() });
      moved.set(i.id, i.id);
    }
    this.storage.removeItem(GUEST_KEY);
    return moved;
  }
}

// One store per signed-in identity, so views never race to create competing instances.
let shared: Promise<PlannerStore> | null = null;
let sharedFor: string | null = null;
export function sharedPlannerStore(identity: string) {
  if (!shared || sharedFor !== identity) {
    sharedFor = identity;
    shared = PlannerStore.create();
  }
  return shared;
}
