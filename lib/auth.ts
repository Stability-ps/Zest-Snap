/** Only same-site app paths are allowed after sign-in, so auth links can't redirect elsewhere. */
export function safeAuthNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/app";
  try {
    const url = new URL(value, "https://zestsnap.app");
    if (url.origin !== "https://zestsnap.app") return "/app";
    if (url.pathname === "/auth/verified" || url.pathname === "/reset-password" || url.pathname === "/settings" || url.pathname === "/app" || url.pathname === "/admin" || /^\/admin\/[a-z0-9/_-]{1,120}$/i.test(url.pathname) || /^\/share(d)?\/[0-9a-f-]{36}$/i.test(url.pathname))
      return url.pathname + url.search;
  } catch {}
  return "/app";
}
