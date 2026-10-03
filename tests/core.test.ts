import { test } from "node:test";
import assert from "node:assert/strict";
import { eventFingerprint, validateEvent } from "../lib/events";
import { generateIcs } from "../lib/ics";
import { validateUpload, readBoundedJson } from "../lib/upload";
import { LocalDataProvider } from "../lib/data/local";
import { mergeLocal } from "../lib/data";
import { emptyState } from "../lib/data/types";
import { safeAuthNext } from "../lib/auth";
import manifest from "../app/manifest";
import type { ExtractedEvent } from "../lib/extraction-types";
const event: ExtractedEvent = {
  title: "Meeting",
  startDate: "2027-04-03",
  endDate: "2027-04-03",
  startTime: "10:00",
  endTime: "11:00",
  allDay: false,
  timezone: "America/New_York",
  location: "Office",
  description: "Notes",
  confidence: 1,
  confidenceReason: "Explicit",
  sourceText: "",
  category: "meeting",
};
test("fingerprints normalize title/location and distinguish timezones", () => {
  assert.equal(
    eventFingerprint(event),
    eventFingerprint({ ...event, title: " MEETING ", location: "office" }),
  );
  assert.notEqual(
    eventFingerprint(event),
    eventFingerprint({ ...event, timezone: "Europe/London" }),
  );
});
test("multi-event export uses stable UIDs, UTC, escaping, UTF-8 folding", async () => {
  const first = await generateIcs([
    event,
    {
      ...event,
      title: "日".repeat(80) + "\r\nBEGIN:VEVENT",
      startDate: "2027-04-04",
      endDate: "2027-04-04",
    },
  ]);
  assert.equal((first.match(/^BEGIN:VEVENT$/gm) || []).length, 2);
  assert.match(first, /DTSTART:20270403T140000Z/);
  assert.match(first, /\\nBEGIN:VEVENT/);
  for (const line of first.split("\r\n"))
    assert.ok(Buffer.byteLength(line) <= 75);
  assert.equal(
    first.match(/UID:.*/)?.[0],
    (await generateIcs([event])).match(/UID:.*/)?.[0],
  );
});
test("all-day end is exclusive and multi-day inclusive input preserved", async () => {
  const text = await generateIcs([
    {
      ...event,
      allDay: true,
      startTime: "",
      endTime: "",
      endDate: "2027-04-05",
    },
  ]);
  assert.match(text, /DTSTART;VALUE=DATE:20270403/);
  assert.match(text, /DTEND;VALUE=DATE:20270406/);
});
test("missing end time has nonzero duration", async () => {
  assert.match(
    await generateIcs([{ ...event, endTime: "" }]),
    /DTEND:20270403T150000Z/,
  );
});
test("invalid dates, reverse times and DST ambiguity are rejected", () => {
  assert.throws(() => validateEvent({ ...event, startDate: "2027-02-30" }));
  assert.throws(() => validateEvent({ ...event, endTime: "09:00" }));
  assert.throws(() =>
    validateEvent({
      ...event,
      startDate: "2027-11-07",
      endDate: "2027-11-07",
      startTime: "01:30",
      endTime: "02:30",
    }),
  );
});
test("same event twice generates one calendar entry", async () =>
  assert.equal(
    (await generateIcs([event, event])).match(/BEGIN:VEVENT/g)?.length,
    1,
  ));
test("malformed base64, MIME mismatch, forged signatures and context rejected", () => {
  for (const b of [
    { mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,@@@@" },
    { mimeType: "application/pdf", dataUrl: "data:image/png;base64,AAAA" },
    { mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,AAAA" },
  ])
    assert.throws(() => validateUpload(b));
  assert.equal(
    validateUpload({
      mimeType: "application/pdf",
      dataUrl:
        "data:application/pdf;base64," +
        Buffer.from("%PDF-1.7\n").toString("base64"),
    }).mimeType,
    "application/pdf",
  );
});
test("bounded parser handles absent content length and rejects oversized streams", async () => {
  await assert.rejects(() =>
    readBoundedJson(
      new Request("https://a.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: "x".repeat(100) }),
      }),
      20,
    ),
  );
});
test("local v2 data remains intact and repeat migration is idempotent", async () => {
  const map = new Map<string, string>();
  const p = new LocalDataProvider({
    getItem: (k) => map.get(k) || null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  });
  const state = {
    ...emptyState,
    events: [{ ...event, id: "1", addedAt: "2027-01-01T00:00:00Z" }],
    credits: 999,
    firstScanRewarded: true,
  };
  await p.save(state);
  assert.deepEqual(await p.load(), state);
  const once = mergeLocal(state, emptyState);
  assert.deepEqual(mergeLocal(state, once), once);
  assert.equal(once.credits, 0);
});
test("auth redirect allowlist rejects external and protocol-relative links", () => {
  for (const x of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/admin",
    "%2f%2fevil.test",
  ])
    assert.equal(safeAuthNext(x), "/app");
  assert.equal(safeAuthNext("/reset-password"), "/reset-password");
});
test("manifest has supported raster icons and app scope", () => {
  const m = manifest();
  assert.equal(m.start_url, "/app");
  assert.equal(m.scope, "/");
  assert.ok(m.icons?.some((i) => i.sizes === "192x192"));
  assert.ok(
    m.icons?.some((i) => i.purpose === "maskable" && i.sizes === "512x512"),
  );
});
