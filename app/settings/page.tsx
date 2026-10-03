"use client";
import { useEffect, useState } from "react";
import {
  getDataProvider,
  migrateLocal,
  LocalDataProvider,
  defaultProfile,
  type DataProvider,
  type Profile,
  type Usage,
} from "@/lib/data";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { clearCloudCaches } from "@/lib/data/cached";
import { productConfig } from "@/lib/product-config";
export default function Settings() {
  const [provider, setProvider] = useState<DataProvider | null>(null),
    [profile, setProfile] = useState<Profile>(defaultProfile),
    [usage, setUsage] = useState<Usage | null>(null),
    [flags, setFlags] = useState<Record<string, boolean>>({}),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    getDataProvider()
      .then(async (p) => {
        setProvider(p);
        setProfile(await p.loadProfile());
        setUsage(await p.loadUsage());
        setFlags(await p.loadFeatureFlags());
      })
      .catch(() => setMessage("Account unavailable. Reconnect and try again."));
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="settingsPage">
      <div className="settingsWrap">
        <a href="/app">← Back to Zest Snap</a>
        <h1>Settings</h1>
        <p>
          {provider?.mode === "cloud" ? "Signed-in account" : "Guest mode"}
        </p>
        <section className="settingsStorage" aria-label="Storage">
          <span>Storage</span>
          <strong>
            {provider?.mode === "cloud"
              ? "Synced to your account"
              : "On this device"}
          </strong>
        </section>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              new Intl.DateTimeFormat(profile.locale, {
                timeZone: profile.timezone,
              });
              await provider?.updateProfile(profile);
              setMessage("Preferences saved.");
            });
          }}
          className="settingsForm"
        >
          <label>
            Display name
            <input
              maxLength={100}
              value={profile.displayName}
              onChange={(e) =>
                setProfile({ ...profile, displayName: e.target.value })
              }
            />
          </label>
          <label>
            Timezone
            <input
              required
              value={profile.timezone}
              placeholder="Europe/London"
              onChange={(e) =>
                setProfile({ ...profile, timezone: e.target.value })
              }
            />
          </label>
          <label>
            Language / locale
            <input
              required
              value={profile.locale}
              placeholder="en-GB"
              onChange={(e) =>
                setProfile({ ...profile, locale: e.target.value })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={profile.reminders}
              onChange={(e) =>
                setProfile({ ...profile, reminders: e.target.checked })
              }
            />{" "}
            Show in-app upcoming insights
          </label>
          <p>
            Push notifications and weekly email delivery are not enabled. No
            notification permission is requested.
          </p>
          <p>
            Calendar preference: downloadable ICS files for Apple Calendar,
            Google Calendar and Outlook. Direct account connections are not
            enabled. Missing end times use a one-hour export duration.
          </p>
          <label>
            History retention
            <select
              value={profile.retentionDays}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  retentionDays: Number(e.target.value),
                })
              }
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
              <option value={0}>Until I delete it</option>
            </select>
          </label>
          <p>
            Retention removes scan history when you open the app. Saved agenda
            items are kept separately. Original uploads are never saved on this
            device or in Zest cloud storage.
          </p>
          <button className="button" disabled={busy || !provider}>
            Save preferences
          </button>
        </form>
        <h2>Plan & usage</h2>
        <p>
          Scan allowance ·{" "}
          {usage
            ? `${usage.scans} / ${usage.allowance} scans this month`
            : "Loading…"}
          .{" "}
          {provider?.mode === "local"
            ? "Device history is an estimate; server abuse limits also apply."
            : ""}{" "}
          Paid plans and credit redemption are not active.
        </p>
        {provider?.mode === "cloud" && flags.referrals && (
          <section>
            <h2>Invites</h2>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const code = await provider.createReferral();
                  setMessage(
                    "Invite link: " +
                      window.location.origin +
                      "/login?ref=" +
                      encodeURIComponent(code),
                  );
                })
              }
            >
              Create invite link
            </button>
          </section>
        )}
        <h2>Privacy & data</h2>
        <p>
          Export before clearing data. Cloud deletion removes your account and
          Zest records; downloaded files and external calendar events remain
          under your control.
        </p>
        <div className="settingsActions">
          <button
            disabled={busy || !provider}
            onClick={() =>
              run(async () => {
                const blob = new Blob(
                  [JSON.stringify(await provider!.exportData(), null, 2)],
                  { type: "application/json" },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "zest-snap-data.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                setMessage("Data export prepared.");
              })
            }
          >
            Export my data
          </button>
          {provider?.mode === "cloud" && (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await migrateLocal(provider);
                  setMessage(
                    "Local history and agenda merged safely. Milestone progress was imported separately; cloud credits require verified actions.",
                  );
                })
              }
            >
              Merge this device’s guest history & agenda
            </button>
          )}
          <button
            disabled={busy || !provider}
            onClick={() => {
              if (
                window.confirm(
                  provider?.mode === "cloud"
                    ? "Permanently delete your Zest account and all cloud data?"
                    : "Clear all Zest data on this device?",
                )
              )
                run(async () => {
                  await provider!.deleteData();
                  await new LocalDataProvider(localStorage).deleteData();
                  window.location.assign(
                    new URL("/app", window.location.origin).href,
                  );
                });
            }}
          >
            {provider?.mode === "cloud"
              ? "Delete my account"
              : "Clear device data"}
          </button>
          {isSupabaseConfigured() && (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const { error } = await createClient().auth.signOut();
                  if (error) throw new Error("Sign out failed. Try again.");
                  clearCloudCaches(localStorage);
                  window.location.assign(
                    new URL("/login", window.location.origin).href,
                  );
                })
              }
            >
              Sign out
            </button>
          )}
        </div>
        <p>
          <a href="/login">Account / sign in</a>
        </p>
        <p role="status">{message}</p>
        <h2>Support</h2>
        <a href={"mailto:" + productConfig.supportEmail}>
          {productConfig.supportEmail}
        </a>
        <p>
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
        </p>
      </div>
    </main>
  );
}
