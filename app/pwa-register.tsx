"use client";
import { useEffect, useState } from "react";
export default function PwaRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let active = true;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
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
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  if (!waiting) return null;
  return (
    <aside className="updateNotice" role="status">
      A Zest Snap update is ready. Finish your changes first.{" "}
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
