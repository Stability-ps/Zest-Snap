"use client";
import { useEffect, useState } from "react";
import { UserRound, SlidersHorizontal, Bell, CalendarDays, Database, CreditCard, LifeBuoy, ChevronRight, LogIn, Download, Trash2 } from "lucide-react";
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
  async function saveProfile(next: Profile) {
    setProfile(next);
    if (!provider) return;
    try {
      new Intl.DateTimeFormat(next.locale, { timeZone: next.timezone });
      await provider.updateProfile(next);
      setMessage("Saved");
      window.setTimeout(() => setMessage(""), 1800);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save preference.");
    }
  }
  const timezoneOptions = [
    ["Africa/Johannesburg", "Johannesburg (GMT+2)"],
    ["Africa/Lagos", "Lagos"],
    ["Africa/Nairobi", "Nairobi"],
    ["Europe/London", "London"],
    ["Europe/Paris", "Paris"],
    ["Europe/Berlin", "Berlin"],
    ["America/New_York", "New York"],
    ["America/Chicago", "Chicago"],
    ["America/Denver", "Denver"],
    ["America/Los_Angeles", "Los Angeles"],
    ["America/Toronto", "Toronto"],
    ["America/Sao_Paulo", "São Paulo"],
    ["Asia/Dubai", "Dubai"],
    ["Asia/Kolkata", "India"],
    ["Asia/Singapore", "Singapore"],
    ["Asia/Tokyo", "Tokyo"],
    ["Asia/Shanghai", "Shanghai"],
    ["Australia/Sydney", "Sydney"],
    ["Pacific/Auckland", "Auckland"],
  ] as const;
  const localeOptions = [
    ["en", "English"],
    ["en-GB", "English (UK)"],
    ["en-US", "English (US)"],
    ["af", "Afrikaans"],
    ["es", "Spanish"],
    ["fr", "French"],
    ["de", "German"],
    ["pt", "Portuguese"],
    ["zh-CN", "Chinese (Simplified)"],
    ["hi", "Hindi"],
    ["ar", "Arabic"],
  ] as const;
  return (
    <main className="settingsPage">
      <div className="settingsWrap settingsNative">
        <a className="settingsBack" href="/app">← Zest Snap</a>
        <div className="settingsTitle"><div><h1>Settings</h1><p>{provider?.mode === "cloud" ? "Signed-in account" : "Guest mode"}</p></div>{message && <span className="settingsSaved" role="status">{message}</span>}</div>

        <h2 className="settingsSectionTitle">Account</h2>
        <section className="settingsGroup">
          <div className="settingsRow"><span className="settingsIcon"><Database /></span><span className="settingsRowCopy"><b>Storage</b><small>{provider?.mode === "cloud" ? "Synced to your account" : "On this device"}</small></span></div>
          <a className="settingsRow" href="/login"><span className="settingsIcon"><LogIn /></span><span className="settingsRowCopy"><b>{provider?.mode === "cloud" ? "Account" : "Sign in"}</b><small>{provider?.mode === "cloud" ? profile.displayName || "Manage your account" : "Sync your planner and history"}</small></span><ChevronRight /></a>
        </section>

        <h2 className="settingsSectionTitle">Preferences</h2>
        <section className="settingsGroup">
          <label className="settingsRow editable"><span className="settingsIcon"><UserRound /></span><span className="settingsRowCopy"><b>Display name</b><small>How Zest addresses you</small></span><input aria-label="Display name" maxLength={100} value={profile.displayName} placeholder="Add name" onChange={e=>setProfile({...profile,displayName:e.target.value})} onBlur={()=>saveProfile(profile)} /></label>
          <label className="settingsRow selectRow"><span className="settingsIcon"><SlidersHorizontal /></span><span className="settingsRowCopy"><b>Timezone</b><small>Dates and reminders use this timezone</small></span><select aria-label="Timezone" value={profile.timezone} onChange={e=>saveProfile({...profile,timezone:e.target.value})}>{!timezoneOptions.some(([value])=>value===profile.timezone)&&<option value={profile.timezone}>{profile.timezone.replaceAll("_"," ")}</option>}{timezoneOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><ChevronRight /></label>
          <label className="settingsRow selectRow"><span className="settingsIcon"><SlidersHorizontal /></span><span className="settingsRowCopy"><b>Language</b><small>App language and date formatting</small></span><select aria-label="Language" value={profile.locale} onChange={e=>saveProfile({...profile,locale:e.target.value})}>{!localeOptions.some(([value])=>value===profile.locale)&&<option value={profile.locale}>{profile.locale}</option>}{localeOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><ChevronRight /></label>
          <label className="settingsRow"><span className="settingsIcon"><Bell /></span><span className="settingsRowCopy"><b>Upcoming insights</b><small>Helpful reminders inside Zest</small></span><input className="settingsToggle" type="checkbox" checked={profile.reminders} onChange={e=>saveProfile({...profile,reminders:e.target.checked})} /></label>
        </section>

        <h2 className="settingsSectionTitle">Calendar & history</h2>
        <section className="settingsGroup">
          <div className="settingsRow"><span className="settingsIcon"><CalendarDays /></span><span className="settingsRowCopy"><b>Device calendar</b><small>Export selected events to your calendar</small></span><span className="settingsValue">ICS</span></div>
          <label className="settingsRow"><span className="settingsIcon"><Database /></span><span className="settingsRowCopy"><b>Scan history</b><small>Choose how long scan history is kept</small></span><select aria-label="History retention" value={profile.retentionDays} onChange={e=>saveProfile({...profile,retentionDays:Number(e.target.value)})}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option><option value={0}>Until deleted</option></select></label>
        </section>

        <h2 className="settingsSectionTitle">Plan & usage</h2>
        <section className="settingsGroup">
          <div className="settingsRow"><span className="settingsIcon"><CreditCard /></span><span className="settingsRowCopy"><b>Monthly scans</b><small>{usage ? `${usage.scans} of ${usage.allowance} used this month` : "Loading usage…"}</small></span></div>
          <a className="settingsRow" href="/app?view=rewards"><span className="settingsIcon"><CreditCard /></span><span className="settingsRowCopy"><b>Zest Credits</b><small>View rewards and earned credits</small></span><ChevronRight /></a>
        </section>

        <h2 className="settingsSectionTitle">Privacy & data</h2>
        <section className="settingsGroup">
          <button className="settingsRow" disabled={busy||!provider} onClick={()=>run(async()=>{const blob=new Blob([JSON.stringify(await provider!.exportData(),null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="zest-snap-data.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage("Data export prepared");})}><span className="settingsIcon"><Download /></span><span className="settingsRowCopy"><b>Export my data</b><small>Download a copy of your Zest data</small></span><ChevronRight /></button>
          <button className="settingsRow dangerRow" disabled={busy||!provider} onClick={()=>{if(window.confirm(provider?.mode==="cloud"?"Permanently delete your Zest account and all cloud data?":"Clear all Zest data on this device?"))run(async()=>{await provider!.deleteData();await new LocalDataProvider(localStorage).deleteData();window.location.assign(new URL("/app",window.location.origin).href);});}}><span className="settingsIcon"><Trash2 /></span><span className="settingsRowCopy"><b>{provider?.mode==="cloud"?"Delete my account":"Clear device data"}</b><small>This cannot be undone</small></span><ChevronRight /></button>
        </section>

        <h2 className="settingsSectionTitle">Support</h2>
        <section className="settingsGroup">
          <a className="settingsRow" href={"mailto:"+productConfig.supportEmail}><span className="settingsIcon"><LifeBuoy /></span><span className="settingsRowCopy"><b>Contact support</b><small>{productConfig.supportEmail}</small></span><ChevronRight /></a>
          <a className="settingsRow" href="/privacy"><span className="settingsRowCopy"><b>Privacy</b></span><ChevronRight /></a>
          <a className="settingsRow" href="/terms"><span className="settingsRowCopy"><b>Terms</b></span><ChevronRight /></a>
        </section>
        <p className="settingsFootnote">Original uploads are not retained by Zest after processing. Calendar files you export remain under your control.</p>
      </div>
    </main>
  );
}
