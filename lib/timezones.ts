const FALLBACK = [
  "UTC", "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos", "Africa/Nairobi", "America/Anchorage", "America/Bogota",
  "America/Chicago", "America/Denver", "America/Halifax", "America/Los_Angeles", "America/Mexico_City", "America/New_York",
  "America/Phoenix", "America/Santiago", "America/Sao_Paulo", "America/St_Johns", "America/Toronto", "America/Vancouver",
  "Asia/Bangkok", "Asia/Dhaka", "Asia/Dubai", "Asia/Hong_Kong", "Asia/Jakarta", "Asia/Jerusalem", "Asia/Karachi",
  "Asia/Kathmandu", "Asia/Kolkata", "Asia/Manila", "Asia/Riyadh", "Asia/Seoul", "Asia/Shanghai", "Asia/Singapore",
  "Asia/Tehran", "Asia/Tokyo", "Atlantic/Azores", "Atlantic/Reykjavik", "Australia/Adelaide", "Australia/Brisbane",
  "Australia/Perth", "Australia/Sydney", "Europe/Amsterdam", "Europe/Athens", "Europe/Berlin", "Europe/Dublin",
  "Europe/Istanbul", "Europe/Lisbon", "Europe/London", "Europe/Madrid", "Europe/Moscow", "Europe/Paris", "Europe/Rome",
  "Europe/Stockholm", "Europe/Warsaw", "Pacific/Auckland", "Pacific/Fiji", "Pacific/Honolulu",
];

// CLDR (and so Intl.supportedValuesOf) still uses some pre-rename IANA ids; show the current names.
const MODERN: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Asia/Dacca": "Asia/Dhaka",
  "Asia/Thimbu": "Asia/Thimphu",
  "Europe/Kiev": "Europe/Kyiv",
  "Africa/Asmera": "Africa/Asmara",
  "America/Godthab": "America/Nuuk",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Mendoza": "America/Argentina/Mendoza",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Louisville": "America/Kentucky/Louisville",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};
const usable = (zone: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

function offset(zone: string, at: Date) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    return part === "GMT" ? "GMT+0" : part || "";
  } catch {
    return "";
  }
}

/** Human label such as "Johannesburg · Africa (GMT+2)". */
export function timezoneLabel(zone: string, at = new Date()) {
  if (!zone) return "UTC";
  const parts = zone.split("/");
  const city = parts[parts.length - 1].replaceAll("_", " ");
  const region = parts.length > 1 ? parts[0].replaceAll("_", " ") : "";
  const off = offset(zone, at);
  return `${city}${region ? " · " + region : ""}${off ? ` (${off})` : ""}`;
}

/** Every IANA zone the runtime supports (Intl.supportedValuesOf), with a broad fallback list. */
export function timezoneOptions(): [string, string][] {
  let zones: string[] = FALLBACK;
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (supported?.length) zones = supported.includes("UTC") ? supported : ["UTC", ...supported];
  } catch {}
  zones = [...new Set(zones.map((z) => (MODERN[z] && usable(MODERN[z]) ? MODERN[z] : z)))];
  const now = new Date();
  return zones.map((z) => [z, timezoneLabel(z, now)] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
}
