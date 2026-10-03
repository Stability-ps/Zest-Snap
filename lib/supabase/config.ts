export function isSupabaseConfigured() {
  // Cloud mode is opt-in. Having Supabase values present in a local shell or
  // inherited environment must never silently switch the app out of local mode.
  if (process.env.NEXT_PUBLIC_CLOUD_ENABLED !== "true") return false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return false;

  try {
    return (
      new URL(url).protocol === "https:" &&
      (key.startsWith("sb_publishable_") || key.startsWith("eyJ"))
    );
  } catch {
    return false;
  }
}
