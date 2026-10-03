import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./config";

export { isSupabaseConfigured } from "./config";

export function createClient() {
  const { url, key } = getSupabasePublicConfig();
  if (!url || !key)
    throw new Error("Supabase is not configured for Zest Snap yet.");
  return createBrowserClient(url, key);
}
