export const MAX_BODY_BYTES = 4_100_000;
export type Upload = {
  dataUrl: string;
  mimeType: string;
  fileName: string;
  locale: string;
  timezone: string;
  /** What the person mostly scans (Settings › What you snap). Allow-listed ids only: never free text. */
  interests: string[];
};
const INTEREST_HINTS = ["school", "health", "work", "bills", "events", "travel"];
export async function readBoundedJson(
  req: Request,
  max = MAX_BODY_BYTES,
): Promise<unknown> {
  if (Number(req.headers.get("content-length") || 0) > max)
    throw new Error("upload_too_large");
  if (!req.headers.get("content-type")?.includes("application/json"))
    throw new Error("invalid_upload");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("invalid_upload");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new Error("upload_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("invalid_upload");
  }
}
export function validateUpload(body: unknown): Upload {
  if (!body || typeof body !== "object") throw new Error("invalid_upload");
  const b = body as Record<string, unknown>;
  if (
    typeof b.dataUrl !== "string" ||
    typeof b.mimeType !== "string" ||
    b.dataUrl.length > 4_000_100
  )
    throw new Error("invalid_upload");
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowed.includes(b.mimeType)) throw new Error("unsupported_format");
  const prefix = `data:${b.mimeType};base64,`;
  if (!b.dataUrl.startsWith(prefix)) throw new Error("invalid_upload");
  const encoded = b.dataUrl.slice(prefix.length);
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    throw new Error("invalid_upload");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 3_000_000) throw new Error("upload_too_large");
  const sig = bytes.subarray(0, 12).toString("hex");
  const valid =
    b.mimeType === "application/pdf"
      ? bytes.subarray(0, 5).toString() === "%PDF-"
      : b.mimeType === "image/jpeg"
        ? sig.startsWith("ffd8ff")
        : b.mimeType === "image/png"
          ? sig.startsWith("89504e470d0a1a0a")
          : bytes.subarray(0, 4).toString() === "RIFF" &&
            bytes.subarray(8, 12).toString() === "WEBP";
  if (!valid) throw new Error("invalid_upload");
  const timezone = typeof b.timezone === "string" ? b.timezone : "UTC";
  const locale = typeof b.locale === "string" ? b.locale : "en";
  try {
    new Intl.DateTimeFormat(locale, { timeZone: timezone });
  } catch {
    throw new Error("invalid_context");
  }
  return {
    dataUrl: b.dataUrl,
    mimeType: b.mimeType,
    fileName: b.mimeType === "application/pdf" ? "document.pdf" : "image",
    timezone,
    locale,
    interests: Array.isArray(b.interests) ? [...new Set(b.interests.filter((x): x is string => typeof x === "string" && INTEREST_HINTS.includes(x)))] : [],
  };
}
