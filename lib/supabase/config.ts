export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return { url, key };
}

export function isSupabaseConfigured() {
  const { url, key } = getSupabasePublicConfig();
  if (process.env.NEXT_PUBLIC_CLOUD_ENABLED === "false" || !url || !key)
    return false;

  try {
    return (
      new URL(url).protocol === "https:" &&
      (key.startsWith("sb_publishable_") || key.startsWith("eyJ"))
    );
  } catch {
    return false;
  }
}
