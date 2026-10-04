/** RFC 4180 CSV with spreadsheet formula-injection protection. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // Cells beginning with these characters are evaluated as formulas by Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvRow(values: unknown[]) {
  return values.map(csvCell).join(",") + "\r\n";
}

export function csvFilename(dataset: string, from: Date, to: Date) {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(to.getTime() - 1);
  return `zest-snap-${dataset.replace(/[^a-z0-9_-]/gi, "")}-${day(from)}-to-${day(end)}.csv`;
}
