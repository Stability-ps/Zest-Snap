const ZEST_SUPABASE_URL_FALLBACK = "https://rnlqsaaoywqrvokoysei.supabase.co";
const ZEST_SUPABASE_PUBLISHABLE_KEY_FALLBACK = "sb_publishable_EkZKedt5pyc3gYNmA2b3mw_9PaqMD5z";

export function getSupabasePublicConfig() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ZEST_SUPABASE_URL_FALLBACK;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ZEST_SUPABASE_PUBLISHABLE_KEY_FALLBACK;

  return { url, key };
}

export function isSupabaseConfigured() {
  const { url, key } = getSupabasePublicConfig();
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
