import { toPdfSafeText } from "./pdf-text";

export type PdfExportContext = {
  locale?: string;
  displayName?: string;
  timezone?: string;
  retentionLabel: string;
  usage: { scans: number; allowance: number } | null;
  now?: Date;
};

/**
 * Readable PDF summary of a Zest Snap data export (same content as the JSON export, summarised).
 * Pure: no DOM, so it is unit-tested. Every string goes through toPdfSafeText so no user text can make
 * the standard font throw.
 */
export async function buildExportPdf(data: unknown, ctx: PdfExportContext): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle("Zest Snap data export");
  pdf.setCreator("Zest Snap");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 48;
  const maxWidth = pageSize[0] - margin * 2;
  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;

  const clean = (value: unknown) => toPdfSafeText(value);
  const wrap = (text: string, size = 10, f = font) => {
    const words = clean(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? line + " " + word : word;
      if (f.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else {
        if (line) lines.push(line);
        // A single word wider than the page (long URL, id) is hard-broken so it never overflows.
        let rest = word;
        while (f.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
          let cut = rest.length - 1;
          while (cut > 1 && f.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };
  const ensure = (height: number) => {
    if (y - height >= margin) return;
    page = pdf.addPage(pageSize);
    y = pageSize[1] - margin;
  };
  const heading = (text: string, size = 16) => {
    for (const row of wrap(text, size, bold)) {
      ensure(size + 18);
      page.drawText(row, { x: margin, y, size, font: bold, color: rgb(0.04, 0.12, 0.23) });
      y -= size + 10;
    }
  };
  const line = (label: string, value: unknown) => {
    const lines = wrap(label + ": " + clean(value || "—"), 10);
    ensure(lines.length * 14 + 4);
    for (const row of lines) {
      page.drawText(row, { x: margin, y, size: 10, font, color: rgb(0.22, 0.29, 0.36) });
      y -= 14;
    }
    y -= 2;
  };
  const list = (title: string, items: unknown[]) => {
    heading(title, 13);
    if (!items.length) {
      line("Status", "None");
      return;
    }
    items.slice(0, 100).forEach((item, index) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const primary = record.title || record.summary || record.fileName || record.name || "Item " + (index + 1);
      const secondary = record.dueDate || record.startDate || record.scannedAt || record.createdAt || "";
      line(String(index + 1), secondary ? clean(primary) + " — " + clean(secondary) : primary);
    });
    if (items.length > 100) line("More", items.length - 100 + " additional items are included in the JSON export");
  };

  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const nested = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : undefined;
  const exportedProfile = root.profile && typeof root.profile === "object" ? (root.profile as Record<string, unknown>) : {};
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const scans = Array.isArray(root.scans) ? root.scans : arr(nested?.scans);
  const events = Array.isArray(root.events) ? root.events : Array.isArray(root.calendarExports) ? root.calendarExports : arr(nested?.events);
  const planner = arr(root.planner);
  const reminders = arr(root.reminders);

  let generated: string;
  try {
    generated = new Intl.DateTimeFormat(ctx.locale || undefined, { dateStyle: "long", timeStyle: "short" }).format(ctx.now ?? new Date());
  } catch {
    generated = (ctx.now ?? new Date()).toISOString();
  }

  heading("Zest Snap data export", 22);
  line("Generated", generated);
  line("Display name", exportedProfile.displayName || ctx.displayName);
  line("Timezone", exportedProfile.timezone || ctx.timezone);
  line("Language & region", exportedProfile.locale || ctx.locale);
  line("Scan history retention", ctx.retentionLabel);
  line("Monthly scans", ctx.usage ? ctx.usage.scans + " of " + ctx.usage.allowance : "Unavailable");
  if ("credits" in root) line("Zest Credits", root.credits);
  else if (nested && "credits" in nested) line("Zest Credits", nested.credits);

  y -= 8;
  list("Scan history", scans);
  list("Saved calendar events", events);
  list("Planner", planner);
  list("Reminders", reminders);

  y -= 8;
  heading("About this export", 13);
  for (const row of wrap("This PDF is a readable summary of your Zest Snap data. For the complete machine-readable record, use the JSON export in Settings.", 10)) {
    ensure(14);
    page.drawText(row, { x: margin, y, size: 10, font, color: rgb(0.32, 0.39, 0.46) });
    y -= 14;
  }
  return Uint8Array.from(await pdf.save());
}
