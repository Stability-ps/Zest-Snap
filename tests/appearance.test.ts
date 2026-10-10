import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { ACCENTS, NEUTRALS, accentTokens, buildThemeCss, contrast, type Scheme } from "../lib/appearance/palette";
import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  parseAppearance,
  readStoredAppearance,
  resolveScheme,
  writeStoredAppearance,
  type Appearance,
  type StoredAppearance,
} from "../lib/appearance/preferences";
import { reconcile, supabaseAppearanceRemote, syncAppearanceOnce, type AppearanceRemote } from "../lib/appearance/sync";
import { APPEARANCE_BOOT_SCRIPT } from "../lib/appearance/boot";
import { SupabaseDataProvider } from "../lib/data/cloud";
import { defaultProfile } from "../lib/data/types";
import { migratedDb, as } from "./helpers/db";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const memory = (seed: Record<string, string> = {}) => {
  const data = { ...seed };
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), data };
};
const stored = (over: Partial<StoredAppearance> = {}): StoredAppearance => ({ ...DEFAULT_APPEARANCE, owner: null, dirty: false, ...over });

// ---- Theme CSS -----------------------------------------------------------------------------------------

test("app/theme.css is generated from lib/appearance/palette.ts (run `npm run theme:css`)", () => {
  assert.equal(readFileSync("app/theme.css", "utf8"), buildThemeCss());
});

test("every accent meets WCAG AA in Light and Dark mode", () => {
  for (const scheme of ["light", "dark"] as Scheme[]) {
    const n = NEUTRALS[scheme];
    for (const { id, hex } of ACCENTS) {
      const t = accentTokens(hex, scheme);
      const where = `${id}/${scheme}`;
      for (const bg of [n.surface, n.bg, n["surface-2"], n.elevated]) {
        assert.ok(contrast(t.accent, bg) >= 3, `${where}: accent vs ${bg}`);
        assert.ok(contrast(t["accent-text"], bg) >= 4.5, `${where}: accent-text vs ${bg}`);
      }
      assert.ok(contrast(t["accent-text"], t["accent-soft"]) >= 4.5, `${where}: accent-text on accent-soft`);
      assert.ok(contrast(t["on-accent"], t["accent-strong"]) >= 4.5, `${where}: button label`);
    }
  }
});

test("neutral and semantic text tokens meet WCAG AA on every surface; controls reach 3:1", () => {
  for (const scheme of ["light", "dark"] as Scheme[]) {
    const n = NEUTRALS[scheme];
    for (const surface of ["surface", "bg", "surface-2", "elevated"]) {
      for (const text of ["text", "text-2", "text-3", "success-text", "warning-text", "danger-text", "info-text", "brand-text"])
        assert.ok(contrast(n[text], n[surface]) >= 4.5, `${scheme}: ${text} on ${surface} = ${contrast(n[text], n[surface]).toFixed(2)}`);
      assert.ok(contrast(n["control-border"], n[surface]) >= 3, `${scheme}: control-border on ${surface}`);
    }
    // Secondary text also sits on every tinted card (status boxes, accent-tinted timeline items).
    const tints = [n["surface-3"], n["success-soft"], n["warning-soft"], n["danger-soft"], n["info-soft"], ...ACCENTS.map((a) => accentTokens(a.hex, scheme)["accent-soft"])];
    for (const tint of tints)
      for (const text of ["text", "text-2", "text-3"]) assert.ok(contrast(n[text], tint) >= 4.5, `${scheme}: ${text} on ${tint}`);
    for (const soft of ["success", "warning", "danger"])
      assert.ok(contrast(n[`${soft}-text`], n[`${soft}-soft`]) >= 4.5, `${scheme}: ${soft}-text on ${soft}-soft`);
    assert.ok(contrast(n["brand-display"], n.surface) >= 3 && contrast(n["brand-display"], n.bg) >= 3, `${scheme}: large brand headline`);
    assert.ok(contrast(n["on-ink"], n.ink) >= 4.5, `${scheme}: primary button label`);
    assert.ok(contrast(n["on-hero"], n.hero) >= 4.5 && contrast(n["on-hero-2"], n.hero) >= 4.5, `${scheme}: hero card text`);
    assert.ok(contrast("#ffffff", n["danger-strong"]) >= 4.5, `${scheme}: destructive button label`);
    assert.ok(contrast("#ffffff", n["control-off"]) >= 1.5 && contrast(n["control-off"], n.surface) >= 1.5, `${scheme}: toggle track visible`);
  }
  // Dark mode is a designed palette, not an inversion: pages are charcoal, cards lift above them.
  assert.ok(contrast(NEUTRALS.dark.surface, NEUTRALS.dark.bg) > 1.05);
});

const STYLESHEETS = ["app/globals.css", "app/shared/[id]/shared-chat.module.css"];

test("components use theme tokens, not hard-coded colours", () => {
  const css = STYLESHEETS.map((f) => readFileSync(f, "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  // Allowed: the fixed Light/Dark depictions in the Appearance thumbnails, the brand capture mark, white glyphs on
  // coloured swatches/toggle knobs and destructive buttons, and neutral drop shadows on swatches.
  const allowed = /^(\.appearanceThumbHalf|\.appearanceSwatch|\.zestCaptureMark|\.settingsToggle:after|\.dangerButton|\.button\.dangerSolid|\.plannerReminderButton span|\.mine \.reaction|\.socialButton|:root\[data-theme="dark"\] \.socialButton)/;
  const offenders: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ").replace(/^@media[^{]*/, "");
    if (allowed.test(selector)) continue;
    const literal = m[2].match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|:\s*(white|black)\b/);
    if (literal) offenders.push(`${selector} → ${literal[0]}`);
  }
  assert.deepEqual(offenders, []);
  for (const file of ["app/password-strength.tsx", "app/login/page.tsx", "app/reset-password/page.tsx", "app/settings/page.tsx", "app/app/page.tsx"])
    assert.doesNotMatch(readFileSync(file, "utf8"), /["']#[0-9a-fA-F]{3,8}["']/, file);
});

test("every CSS variable the stylesheets use is defined", () => {
  const css = STYLESHEETS.map((f) => readFileSync(f, "utf8")).join("\n");
  const theme = readFileSync("app/theme.css", "utf8");
  const defined = new Set([...(theme + css).matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const runtime = new Set(["native-safe-top", "native-safe-right", "native-safe-bottom", "native-safe-left"]);
  const missing = [...css.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]).filter((v) => !defined.has(v) && !runtime.has(v));
  assert.deepEqual([...new Set(missing)], []);
});

// ---- Preferences ---------------------------------------------------------------------------------------

test("Automatic mode and Ocean Blue are the defaults; explicit modes override the OS", () => {
  assert.deepEqual(readStoredAppearance(memory()), stored());
  assert.equal(resolveScheme("system", true), "dark");
  assert.equal(resolveScheme("system", false), "light");
  assert.equal(resolveScheme("light", true), "light");
  assert.equal(resolveScheme("dark", false), "dark");
});

test("invalid stored preferences fall back safely, field by field", () => {
  for (const raw of ["not json", "null", "42", '{"mode":"neon","accent":"pink"}', "[]"])
    assert.deepEqual(readStoredAppearance(memory({ [APPEARANCE_KEY]: raw })), stored(), raw);
  assert.deepEqual(parseAppearance({ mode: "dark", accent: "pink", updatedAt: -5 }), { mode: "dark", accent: "ocean", updatedAt: 0 });
  assert.deepEqual(parseAppearance({ mode: 1, accent: "rose", updatedAt: 7 }), { mode: "system", accent: "rose", updatedAt: 7 });
  const s = memory();
  writeStoredAppearance(s, stored({ mode: "dark", accent: "amber", updatedAt: 5, owner: A, dirty: true }));
  assert.deepEqual(readStoredAppearance(s), stored({ mode: "dark", accent: "amber", updatedAt: 5, owner: A, dirty: true }));
  // A storage that throws (private mode, quota) never breaks the switch.
  assert.doesNotThrow(() => writeStoredAppearance({ setItem: () => { throw new Error("quota"); } }, stored()));
});

// ---- Boot script (first paint) --------------------------------------------------------------------------

function boot(storageValue: string | null, systemDark: boolean, pathname = "/app") {
  const dataset: Record<string, string> = {};
  const style: Record<string, string> = {};
  const metas = [0, 1].map(() => {
    const attrs: Record<string, string> = { media: "(prefers-color-scheme: light)" };
    return { attrs, setAttribute: (k: string, v: string) => void (attrs[k] = v), removeAttribute: (k: string) => void delete attrs[k] };
  });
  const context = {
    document: { documentElement: { dataset, style }, querySelectorAll: () => metas },
    location: { pathname },
    localStorage: { getItem: (k: string) => (k === APPEARANCE_KEY ? storageValue : null) },
    window: { matchMedia: () => ({ matches: systemDark }) },
    matchMedia: () => ({ matches: systemDark }),
  };
  vm.runInNewContext(APPEARANCE_BOOT_SCRIPT, context);
  return { dataset, style, metas: metas.map((m) => m.attrs) };
}

test("boot script applies the stored theme before first paint and never throws", () => {
  assert.equal(boot(null, true).dataset.theme, "dark");
  assert.equal(boot(null, false).dataset.theme, "light");
  assert.equal(boot(null, false).dataset.accent, undefined);
  const dark = boot(JSON.stringify({ mode: "dark", accent: "violet" }), false);
  assert.equal(dark.dataset.theme, "dark");
  assert.equal(dark.dataset.accent, "violet");
  assert.equal(dark.style.colorScheme, "dark");
  assert.equal(boot(JSON.stringify({ mode: "light" }), true).style.colorScheme, "light", "explicit Light on a dark device");
  assert.deepEqual(dark.metas[0], { content: "#0e1114" });
  assert.equal(boot(JSON.stringify({ mode: "light", accent: "rose" }), true).dataset.theme, "light");
  assert.equal(boot("{broken", true).dataset.theme, "dark");
  assert.equal(boot(JSON.stringify({ mode: "evil", accent: "x" }), false).dataset.accent, undefined);
  // Internal admin pages keep their light styling.
  assert.equal(boot(JSON.stringify({ mode: "dark" }), true, "/admin/users").dataset.theme, "light");
  // The landing page is white in every mode (#96); the app itself follows the appearance.
  assert.equal(boot(JSON.stringify({ mode: "dark", accent: "violet" }), true, "/").dataset.theme, "light");
  assert.equal(boot(JSON.stringify({ mode: "dark" }), true, "/app").dataset.theme, "dark");
  assert.doesNotThrow(() => vm.runInNewContext(APPEARANCE_BOOT_SCRIPT, {}));
});

// ---- Account sync ---------------------------------------------------------------------------------------

const remoteOf = (initial: Appearance | null, opts: { failLoad?: boolean; failSave?: boolean } = {}) => {
  const r = { value: initial, saves: [] as Appearance[] };
  const api: AppearanceRemote = {
    load: async () => {
      if (opts.failLoad) throw new Error("offline");
      return r.value;
    },
    save: async (v) => {
      if (opts.failSave) throw new Error("offline");
      r.saves.push(v);
      r.value = v;
    },
  };
  return { r, api };
};
async function run(local: StoredAppearance, remote: ReturnType<typeof remoteOf>, userId = A) {
  let device = local;
  const result = await syncAppearanceOnce({ userId, remote: remote.api, read: () => device, replace: (n) => void (device = n) });
  return { result, device };
}

test("sign-in adopts the account's saved appearance (account switching keeps each person's own)", async () => {
  const remote = remoteOf({ mode: "dark", accent: "violet", updatedAt: 10 });
  const { result, device } = await run(stored({ mode: "light", accent: "rose", updatedAt: 99, owner: B, dirty: true }), remote);
  assert.equal(result, "applied");
  assert.deepEqual(device, stored({ mode: "dark", accent: "violet", updatedAt: 10, owner: A, dirty: false }));
  assert.equal(remote.r.saves.length, 0, "another account's choice is never uploaded");
});

test("an account without a saved appearance (missing record) receives this device's choice", async () => {
  const remote = remoteOf(null);
  const { result, device } = await run(stored({ mode: "dark", accent: "teal", updatedAt: 5 }), remote);
  assert.equal(result, "pushed");
  assert.deepEqual(remote.r.saves, [{ mode: "dark", accent: "teal", updatedAt: 5 }]);
  assert.deepEqual(device, stored({ mode: "dark", accent: "teal", updatedAt: 5, owner: A, dirty: false }));
});

test("cross-device: a newer change on another device replaces this device's copy", async () => {
  const remote = remoteOf({ mode: "light", accent: "amber", updatedAt: 200 });
  const { device } = await run(stored({ mode: "dark", accent: "ocean", updatedAt: 100, owner: A }), remote);
  assert.deepEqual(device, stored({ mode: "light", accent: "amber", updatedAt: 200, owner: A }));
});

test("offline change uploads later; an older offline change loses to a newer one from another device", async () => {
  const newer = remoteOf({ mode: "light", accent: "ocean", updatedAt: 100 });
  const pending = stored({ mode: "dark", accent: "slate", updatedAt: 150, owner: A, dirty: true });
  assert.equal((await run(pending, newer)).result, "pushed");
  assert.deepEqual(newer.r.value, { mode: "dark", accent: "slate", updatedAt: 150 });

  const conflict = remoteOf({ mode: "light", accent: "rose", updatedAt: 300 });
  const { device } = await run(pending, conflict);
  assert.equal(conflict.r.saves.length, 0);
  assert.deepEqual(device, stored({ mode: "light", accent: "rose", updatedAt: 300, owner: A }));
});

test("sync failures keep the device copy and retry later", async () => {
  const pending = stored({ mode: "dark", accent: "slate", updatedAt: 150, owner: A, dirty: true });
  const down = await run(pending, remoteOf(null, { failLoad: true }));
  assert.equal(down.result, "failed");
  assert.deepEqual(down.device, pending);
  const saveFails = await run(pending, remoteOf({ mode: "light", accent: "ocean", updatedAt: 1 }, { failSave: true }));
  assert.equal(saveFails.result, "failed");
  assert.deepEqual(saveFails.device, pending, "still dirty so the next round uploads it");
});

test("no sync loop: an applied or already-uploaded value is not uploaded again", async () => {
  const remote = remoteOf({ mode: "dark", accent: "violet", updatedAt: 10 });
  const first = await run(stored(), remote);
  const second = await run(first.device, remote);
  assert.equal(second.result, "unchanged");
  assert.equal(remote.r.saves.length, 0);
  assert.deepEqual(reconcile(second.device, remote.r.value, A), {});
});

test("a change made while a sync request is in flight is not overwritten", async () => {
  let device = stored({ mode: "dark", accent: "teal", updatedAt: 50, owner: A, dirty: true });
  const remote: AppearanceRemote = {
    load: async () => ({ mode: "light", accent: "ocean", updatedAt: 10 }),
    save: async () => {
      device = { ...device, mode: "light", accent: "rose", updatedAt: 60, dirty: true }; // person taps again
    },
  };
  await syncAppearanceOnce({ userId: A, remote, read: () => device, replace: (n) => void (device = n) });
  assert.equal(device.accent, "rose");
  assert.equal(device.dirty, true);
});

// ---- Database ---------------------------------------------------------------------------------------------

function fakeProfiles(initial: Record<string, unknown>) {
  const row = { preferences: initial as Record<string, unknown>, display_name: "", timezone: "UTC", locale: "en" };
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }), single: async () => ({ data: row, error: null }) }) }),
      update: (values: Record<string, unknown>) => ({ eq: async () => (Object.assign(row, values), { error: null }) }),
    }),
  };
  return { row, db };
}

test("saving other profile preferences keeps the synced appearance (and vice versa)", async () => {
  const { row, db } = fakeProfiles({ reminders: true, appearance: { mode: "dark", accent: "violet", updatedAt: 3 } });
  await new SupabaseDataProvider(db as never, A).updateProfile({ ...defaultProfile, reminders: false });
  assert.deepEqual(row.preferences.appearance, { mode: "dark", accent: "violet", updatedAt: 3 });
  assert.equal(row.preferences.reminders, false);
  await supabaseAppearanceRemote(db as never, A).save({ mode: "light", accent: "amber", updatedAt: 9 });
  assert.equal(row.preferences.reminders, false);
  assert.deepEqual(await supabaseAppearanceRemote(db as never, A).load(), { mode: "light", accent: "amber", updatedAt: 9 });
});

test("RLS: people can save only their own appearance; no migration is needed", async () => {
  const db = await migratedDb();
  for (const id of [A, B]) await db.exec(`insert into auth.users(id,email) values('${id}','${id.slice(-1)}@example.com')`);
  await db.exec(`insert into public.profiles(id) values('${A}'),('${B}') on conflict do nothing`);
  const set = `update public.profiles set preferences = preferences || jsonb_build_object('appearance', jsonb_build_object('mode','dark','accent','violet','updatedAt',1)) where id = $1`;
  await as(db, A, set, [A]);
  await as(db, A, set, [B]);
  const rows = (await db.query<{ id: string; a: unknown }>(`select id, preferences->'appearance' a from public.profiles order by id`)).rows;
  assert.deepEqual(rows.find((r) => r.id === A)?.a, { mode: "dark", accent: "violet", updatedAt: 1 });
  assert.equal(rows.find((r) => r.id === B)?.a ?? null, null, "another account's row is untouched");
  const read = await as<{ a: unknown }>(db, B, `select preferences->'appearance' a from public.profiles where id = $1`, [A]);
  assert.equal(read.rows.length, 0, "and unreadable");
  await db.close();
});
