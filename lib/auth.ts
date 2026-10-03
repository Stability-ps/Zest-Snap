export function safeAuthNext(value: string | null) {
  return value === "/reset-password" ? value : "/app";
}
