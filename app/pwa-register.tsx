"use client";
import { useEffect, useState } from "react";
import { isNative } from "@/lib/native/runtime";
export default function PwaRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    // The iOS/Android apps always load the live site and handle offline natively, so no service worker there.
    if (!("serviceWorker" in navigator) || isNative()) return;
    let active = true;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/app", updateViaCache: "none" })
      .then((reg) => {
        if (reg.waiting) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (
              active &&
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              setWaiting(worker);
          });
        });
        reg.update().catch(() => undefined);
        // Installed PWAs can stay open for days: look for a new release whenever the app returns to the foreground.
        const check = () => document.visibilityState === "visible" && reg.update().catch(() => undefined);
        document.addEventListener("visibilitychange", check);
        cleanup = () => document.removeEventListener("visibilitychange", check);
      })
      .catch(() => undefined);
    let cleanup = () => {};
    return () => {
      active = false;
      cleanup();
    };
  }, []);
  if (!waiting) return null;
  return (
    <aside className="updateNotice" role="status">
      A new version of Zest Snap is ready.{" "}
      <button
        onClick={() => {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => window.location.reload(),
            { once: true },
          );
          waiting.postMessage("SKIP_WAITING");
        }}
      >
        Update now
      </button>
    </aside>
  );
}
