import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { INTRO_BOOT_SCRIPT, INTRO_KEY, RETURNING_KEYS, shouldShowIntro } from "../lib/intro";

type Case = { name: string; path: string; search?: string; keys?: string[]; cookie?: string; show: boolean };

const cases: Case[] = [
  { name: "brand-new device on /app", path: "/app", show: true },
  { name: "trailing slash", path: "/app/", show: true },
  { name: "intro already seen", path: "/app", keys: [INTRO_KEY], show: false },
  ...RETURNING_KEYS.map((k) => ({ name: `returning device (${k})`, path: "/app", keys: [k], show: false })),
  { name: "signed in (Supabase cookie)", path: "/app", cookie: "a=1; sb-rnlq-auth-token=base64-abc", show: false },
  { name: "chunked Supabase cookie", path: "/app", cookie: "sb-rnlq-auth-token.0=x", show: false },
  { name: "unrelated cookie", path: "/app", cookie: "theme=dark; sb=1", show: true },
  { name: "deep link with query", path: "/app", search: "?view=calendar", show: false },
  { name: "other route", path: "/settings", show: false },
  { name: "intro itself", path: "/intro", show: false },
];

function runBoot(c: Case) {
  const keys = new Set(c.keys ?? []);
  let replaced: string | null = null;
  vm.runInNewContext(INTRO_BOOT_SCRIPT, {
    location: { pathname: c.path, search: c.search ?? "", replace: (to: string) => void (replaced = to) },
    localStorage: { getItem: (k: string) => (keys.has(k) ? "1" : null) },
    document: { cookie: c.cookie ?? "" },
  });
  return replaced;
}

for (const c of cases) {
  test(`intro: ${c.name}`, () => {
    const keys = new Set(c.keys ?? []);
    const pure = shouldShowIntro({ path: c.path, search: c.search ?? "", hasKey: (k) => keys.has(k), cookie: c.cookie ?? "" });
    assert.equal(pure, c.show, "shouldShowIntro");
    assert.equal(runBoot(c), c.show ? "/intro" : null, "INTRO_BOOT_SCRIPT");
  });
}

test("intro boot script never throws when storage is blocked", () => {
  assert.doesNotThrow(() =>
    vm.runInNewContext(INTRO_BOOT_SCRIPT, {
      location: { pathname: "/app", search: "", replace: () => undefined },
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
      },
      document: { cookie: "" },
    }),
  );
});
