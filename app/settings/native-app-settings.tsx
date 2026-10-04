"use client";
import { useEffect, useState } from "react";
import { AlarmClock, Bell, CalendarDays, ChevronRight, Info } from "lucide-react";
import { appVersionLabel, isNative, runtime } from "@/lib/native/runtime";
import { openAppSettings } from "@/lib/native/permissions";
import { nativeNotificationState, preciseTimingEnabled, requestPreciseTiming, type NativeNotificationState } from "@/lib/native/notifications";

/** Settings rows that only make sense inside the iOS/Android apps. Renders nothing on the web. */
export default function NativeAppSettings() {
  const [native, setNative] = useState(false);
  const [notifications, setNotifications] = useState<NativeNotificationState>("unsupported");
  const [version, setVersion] = useState("");
  const [precise, setPrecise] = useState(true);

  useEffect(() => {
    if (!isNative()) return;
    setNative(true);
    const refresh = () => {
      nativeNotificationState().then(setNotifications);
      if (runtime() === "android") preciseTimingEnabled().then(setPrecise);
    };
    refresh();
    appVersionLabel().then(setVersion);
    // Permission may change in system Settings while the app is in the background.
    window.addEventListener("zest-app-resume", refresh);
    return () => window.removeEventListener("zest-app-resume", refresh);
  }, []);

  if (!native) return null;
  const notificationLabel = notifications === "enabled" ? "On" : notifications === "blocked" ? "Blocked" : "Off";
  return (
    <>
      <h2 className="settingsSectionTitle">App</h2>
      <section className="settingsGroup">
        <button type="button" className="settingsRow" onClick={() => openAppSettings()}>
          <span className="settingsIcon"><Bell /></span>
          <span className="settingsRowCopy">
            <b>Notifications</b>
            <small>{notifications === "enabled" ? "Reminders arrive even when Zest Snap is closed" : notifications === "blocked" ? "Blocked — tap to allow in Settings" : "Turn on from any reminder in Planner"}</small>
          </span>
          <span className="settingsValue">{notificationLabel}</span>
          <ChevronRight />
        </button>
        {runtime() === "android" && notifications === "enabled" && (
          <button type="button" className="settingsRow" onClick={() => requestPreciseTiming().then(setPrecise).catch(() => undefined)}>
            <span className="settingsIcon"><AlarmClock /></span>
            <span className="settingsRowCopy">
              <b>Precise reminder timing</b>
              <small>{precise ? "Reminders arrive at the exact minute" : "Android may delay reminders by a few minutes to save battery. Tap to allow exact timing."}</small>
            </span>
            <span className="settingsValue">{precise ? "On" : "Off"}</span>
            {!precise && <ChevronRight />}
          </button>
        )}
        <div className="settingsRow">
          <span className="settingsIcon"><CalendarDays /></span>
          <span className="settingsRowCopy"><b>Phone calendar</b><small>Events open in your calendar app to confirm — no calendar access needed</small></span>
        </div>
        <div className="settingsRow">
          <span className="settingsIcon"><Info /></span>
          <span className="settingsRowCopy"><b>Version</b><small>{version || "…"}</small></span>
        </div>
      </section>
    </>
  );
}
