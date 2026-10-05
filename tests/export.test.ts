import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { isWinAnsi, toPdfSafeText } from "../lib/export/pdf-text";
import { buildExportPdf } from "../lib/export/export-pdf";
import { deliverFile, type DeliveryEnv } from "../lib/export/deliver-file";

const hostile = "Dentist 🦷 → 10:00\tRoom 3 · café — “Ava’s” 会議 ≥2 ✓ ő 👨‍👩‍👧 🇿🇦 9:30 PM​ end";

test("PDF text sanitiser keeps everything Helvetica can draw and never yields an unencodable character", async () => {
  assert.equal(toPdfSafeText("Ava’s café — “party” • 50% €5…"), "Ava’s café — “party” • 50% €5…");
  assert.equal(toPdfSafeText("JNB → CPT ≥ 2"), "JNB -> CPT >= 2");
  assert.equal(toPdfSafeText("a\tb\nc d​e"), "a b c d e");
  assert.equal(toPdfSafeText("Dentist 🦷"), "Dentist");
  assert.equal(toPdfSafeText("Family 👨‍👩‍👧 trip 🇿🇦"), "Family trip");
  assert.equal(toPdfSafeText("Erdős"), "Erdos");
  assert.equal(toPdfSafeText("会議"), "??");
  assert.equal(toPdfSafeText(null), "");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const safe = toPdfSafeText(hostile);
  assert.ok([...safe].every((c) => isWinAnsi(c.codePointAt(0)!)));
  assert.doesNotThrow(() => font.widthOfTextAtSize(safe, 10));
  // The original bug: unsanitised text makes the standard font throw and aborted the whole export.
  assert.throws(() => font.widthOfTextAtSize(hostile, 10), /WinAnsi cannot encode/);
});

test("PDF export builds a valid multi-page PDF from real-world data, including emoji and non-Latin text", async () => {
  const items = Array.from({ length: 130 }, (_, i) => ({ title: `${hostile} #${i}`, startDate: "2026-10-05", createdAt: "2026-10-01" }));
  const data = {
    profile: { displayName: "Sandi 🙂", timezone: "Africa/Johannesburg", locale: "en-ZA" },
    scans: [{ summary: "School letter → term dates", fileName: "letter\t1.pdf" }],
    calendarExports: [{ title: "Flight ✈ JNB→CPT", startDate: "2026-11-02" }],
    planner: items,
    reminders: [{ label: "x".repeat(400) }, { id: "https://example.com/" + "a".repeat(300) }],
    credits: 7,
  };
  const bytes = await buildExportPdf(data, { locale: "en", displayName: "Sandi", timezone: "UTC", retentionLabel: "90 days", usage: { scans: 1, allowance: 3 }, now: new Date("2026-10-05T18:30:00Z") });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const parsed = await PDFDocument.load(bytes);
  assert.ok(parsed.getPageCount() >= 3, `pages: ${parsed.getPageCount()}`);
  assert.equal(parsed.getTitle(), "Zest Snap data export");
  // Guest exports (different shape) and empty data also work.
  const empty = await buildExportPdf({}, { retentionLabel: "30 days", usage: null });
  assert.equal((await PDFDocument.load(empty)).getPageCount(), 1);
  const guest = await buildExportPdf({ data: { scans: [{ summary: "Bill" }], events: [], credits: 2 } }, { retentionLabel: "Until deleted", usage: null, locale: "not-a-locale!" });
  assert.ok(guest.length > 500);
});

function fakeEnv(over: Partial<DeliveryEnv> & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean } = {}) {
  const clicks: { href: string; download: string }[] = [];
  const shares: ShareData[] = [];
  const revoked: string[] = [];
  const env: DeliveryEnv = {
    navigator: {
      canShare: over.canShare ?? (() => true),
      share: async (d: ShareData) => {
        shares.push(d);
        if (over.share) await over.share(d);
      },
    } as unknown as DeliveryEnv["navigator"],
    document: {
      body: { appendChild: () => undefined } as unknown as HTMLElement,
      createElement: () => {
        const a = { href: "", download: "", rel: "", style: {} as Record<string, string>, click() { clicks.push({ href: a.href, download: a.download }); }, remove() {} };
        return a as unknown as HTMLElement;
      },
    } as unknown as DeliveryEnv["document"],
    createObjectURL: () => "blob:zest/1",
    revokeObjectURL: (u) => revoked.push(u),
    prefersShareSheet: false,
    schedule: (fn) => fn(),
    ...over,
  };
  return { env, clicks, shares, revoked };
}
const pdf = () => new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" });
const named = (name: string) => Object.assign(new Error(name), { name });

test("desktop browsers always download a real zest-snap-data.pdf, even when Web Share claims PDF support", async () => {
  const { env, clicks, shares, revoked } = fakeEnv({ prefersShareSheet: false });
  assert.equal(await deliverFile(pdf(), "zest-snap-data.pdf", "Zest Snap data export", env), "downloaded");
  assert.deepEqual(clicks, [{ href: "blob:zest/1", download: "zest-snap-data.pdf" }]);
  assert.equal(shares.length, 0);
  assert.deepEqual(revoked, ["blob:zest/1"]);
});

test("touch devices / PWA use the share sheet; cancel stops; any other share failure falls back to a download", async () => {
  const ok = fakeEnv({ prefersShareSheet: true });
  assert.equal(await deliverFile(pdf(), "zest-snap-data.pdf", "t", ok.env), "shared");
  assert.equal(ok.shares[0].files?.[0].name, "zest-snap-data.pdf");
  assert.equal(ok.clicks.length, 0);

  const cancelled = fakeEnv({ prefersShareSheet: true, share: async () => { throw named("AbortError"); } });
  assert.equal(await deliverFile(pdf(), "zest-snap-data.pdf", "t", cancelled.env), "cancelled");
  assert.equal(cancelled.clicks.length, 0);

  for (const failure of ["NotAllowedError", "DataError", "TypeError"]) {
    const failed = fakeEnv({ prefersShareSheet: true, share: async () => { throw named(failure); } });
    assert.equal(await deliverFile(pdf(), "zest-snap-data.pdf", "t", failed.env), "downloaded", failure);
    assert.equal(failed.clicks[0].download, "zest-snap-data.pdf");
  }

  const cannot = fakeEnv({ prefersShareSheet: true, canShare: () => false });
  assert.equal(await deliverFile(pdf(), "zest-snap-data.pdf", "t", cannot.env), "downloaded");
  const throws = fakeEnv({ prefersShareSheet: true, canShare: () => { throw new TypeError("bad"); } });
  assert.equal(await deliverFile(pdf(), "zest-snap-data.pdf", "t", throws.env), "downloaded");
  const noApi = fakeEnv({ prefersShareSheet: true });
  noApi.env.navigator = {};
  assert.equal(await deliverFile(pdf(), "zest-snap-data.pdf", "t", noApi.env), "downloaded");
});

test("iOS/Android apps hand the file to the native share sheet", async () => {
  const shared = fakeEnv({ shareNatively: async () => "shared" });
  assert.equal(await deliverFile(pdf(), "zest-snap-data.pdf", "t", shared.env), "shared");
  assert.equal(shared.clicks.length + shared.shares.length, 0);
  const cancelled = fakeEnv({ shareNatively: async () => "cancelled" });
  assert.equal(await deliverFile(pdf(), "zest-snap-data.pdf", "t", cancelled.env), "cancelled");
  const web = fakeEnv({ shareNatively: async () => null });
  assert.equal(await deliverFile(pdf(), "zest-snap-data.pdf", "t", web.env), "downloaded");
});
