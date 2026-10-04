import "server-only";
import type { ExtractedEvent } from "@/lib/extraction-types";
import { serviceClient } from "@/lib/supabase/admin";

type GoogleConnection = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  calendar_id: string | null;
  calendar_email: string | null;
};

function googleConfig() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("google_calendar_not_configured");
  return { clientId, clientSecret };
}

const PRODUCTION_APP_ORIGIN = "https://app.zestsnap.app";

export function googleCalendarRedirectUri(origin: string) {
  // Vercel may expose its internal *.vercel.app origin to server routes even when
  // the user entered through the production custom domain. OAuth redirect URIs
  // must be stable and exactly match the URI registered with Google.
  const redirectOrigin =
    process.env.VERCEL_ENV === "production" ? PRODUCTION_APP_ORIGIN : origin;
  return new URL("/api/calendar/google/callback", redirectOrigin).toString();
}

export function googleCalendarAuthorizeUrl(origin: string, state: string) {
  const { clientId } = googleConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleCalendarRedirectUri(origin),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ].join(" "),
    state,
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}

export async function exchangeGoogleCode(origin: string, code: string) {
  const { clientId, clientSecret } = googleConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleCalendarRedirectUri(origin),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("google_calendar_token_exchange_failed");
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
}

export async function saveGoogleConnection(
  userId: string,
  token: { access_token: string; refresh_token?: string; expires_in: number; scope?: string },
) {
  let calendarEmail: string | null = null;
  try {
    const primary = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      cache: "no-store",
    });
    if (primary.ok) {
      const body = (await primary.json()) as { id?: string };
      calendarEmail = body.id || null;
    }
  } catch {}

  const db = serviceClient();
  const existing = await db.from("calendar_connections").select("refresh_token").eq("user_id", userId).eq("provider", "google").maybeSingle();
  const refreshToken = token.refresh_token || existing.data?.refresh_token || null;
  const expiresAt = new Date(Date.now() + Math.max(60, token.expires_in - 30) * 1000).toISOString();

  const { error } = await db.from("calendar_connections").upsert(
    {
      user_id: userId,
      provider: "google",
      access_token: token.access_token,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      scope: token.scope || null,
      calendar_id: "primary",
      calendar_email: calendarEmail,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
  if (error) throw new Error("google_calendar_connection_save_failed");
}

export async function getGoogleConnection(userId: string): Promise<GoogleConnection | null> {
  const { data, error } = await serviceClient()
    .from("calendar_connections")
    .select("user_id,access_token,refresh_token,expires_at,scope,calendar_id,calendar_email")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle();
  if (error) throw new Error("google_calendar_connection_load_failed");
  return (data as GoogleConnection | null) || null;
}

async function refreshAccessToken(connection: GoogleConnection) {
  if (!connection.refresh_token) throw new Error("google_calendar_reconnect_required");
  const { clientId, clientSecret } = googleConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: connection.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("google_calendar_reconnect_required");
  const token = (await res.json()) as { access_token: string; expires_in: number; scope?: string };
  const expiresAt = new Date(Date.now() + Math.max(60, token.expires_in - 30) * 1000).toISOString();
  await serviceClient()
    .from("calendar_connections")
    .update({ access_token: token.access_token, expires_at: expiresAt, scope: token.scope || connection.scope, updated_at: new Date().toISOString() })
    .eq("user_id", connection.user_id)
    .eq("provider", "google");
  return token.access_token;
}

export async function googleAccessToken(userId: string) {
  const connection = await getGoogleConnection(userId);
  if (!connection) throw new Error("google_calendar_not_connected");
  const expires = connection.expires_at ? Date.parse(connection.expires_at) : 0;
  if (expires > Date.now() + 60_000) return { token: connection.access_token, connection };
  return { token: await refreshAccessToken(connection), connection };
}

function plusMinutes(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = String(Math.floor((total % 1440) / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return { time: `${hh}:${mm}`, dayOffset: Math.floor(total / 1440) };
}

function addDays(value: string, days: number) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function googleEventBody(event: ExtractedEvent, fallbackTimezone: string) {
  if (!event.startDate) throw new Error("event_date_required");
  const allDay = event.allDay || !event.startTime;
  const description = [event.description?.trim(), event.sourceText?.trim() ? `Source: ${event.sourceText.trim()}` : ""].filter(Boolean).join("\n\n");
  const base = {
    summary: event.title.trim() || "Zest Snap event",
    location: event.location?.trim() || undefined,
    description: description || undefined,
  };
  if (allDay) {
    const end = event.endDate && event.endDate >= event.startDate ? event.endDate : event.startDate;
    return { ...base, start: { date: event.startDate }, end: { date: addDays(end, 1) } };
  }
  const timezone = event.timezone || fallbackTimezone || "UTC";
  let endDate = event.endDate && event.endDate >= event.startDate ? event.endDate : event.startDate;
  let endTime = event.endTime;
  if (!endTime) {
    const fallback = plusMinutes(event.startTime, 60);
    endTime = fallback.time;
    if (fallback.dayOffset) endDate = addDays(endDate, fallback.dayOffset);
  }
  return {
    ...base,
    start: { dateTime: `${event.startDate}T${event.startTime}:00`, timeZone: timezone },
    end: { dateTime: `${endDate}T${endTime}:00`, timeZone: timezone },
  };
}

export async function createGoogleCalendarEvent(userId: string, event: ExtractedEvent, fallbackTimezone: string) {
  const { token, connection } = await googleAccessToken(userId);
  const calendarId = encodeURIComponent(connection.calendar_id || "primary");
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(googleEventBody(event, fallbackTimezone)),
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error("google_calendar_reconnect_required");
    throw new Error("google_calendar_create_failed");
  }
  return (await res.json()) as { id: string; htmlLink?: string };
}
