"use client";
import { useEffect, useState } from "react";
import { UserRound, SlidersHorizontal, Bell, CalendarDays, Database, CreditCard, LifeBuoy, ChevronRight, LogIn, Download, Trash2, X, Check, Search } from "lucide-react";
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
    [busy, setBusy] = useState(false),
    [sheet, setSheet] = useState<"storage"|"timezone"|"region"|"retention"|"calendar"|"clear"|null>(null),
    [sheetSearch, setSheetSearch] = useState("");
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
    ["en", "Automatic"],
    ["en-ZA", "South Africa"],
    ["en-GB", "United Kingdom"],
    ["en-US", "United States"],
    ["en-CA", "Canada"],
    ["en-AU", "Australia"],
    ["en-IN", "India"],
  ] as const;
  const timezoneLabel = timezoneOptions.find(([value])=>value===profile.timezone)?.[1] || profile.timezone.replaceAll("_"," ");
  const localeLabel = localeOptions.find(([value])=>value===profile.locale)?.[1] || "Automatic";
  const retentionLabel = profile.retentionDays===0 ? "Until deleted" : profile.retentionDays===365 ? "1 year" : profile.retentionDays+" days";
  const filteredTimezones = timezoneOptions.filter(([,label])=>label.toLowerCase().includes(sheetSearch.toLowerCase()));
  return (
    <main className="settingsPage">
      <div className="settingsWrap settingsNative">
        <a className="settingsBack" href="/app">← Zest Snap</a>
        <div className="settingsTitle"><div><h1>Settings</h1><p>{provider?.mode === "cloud" ? "Signed-in account" : "Guest mode"}</p></div>{message && <span className="settingsSaved" role="status">{message}</span>}</div>

        <h2 className="settingsSectionTitle">Account</h2>
        <section className="settingsGroup">
          <button type="button" className="settingsRow" onClick={()=>setSheet("storage")}><span className="settingsIcon"><Database /></span><span className="settingsRowCopy"><b>Storage</b><small>{provider?.mode === "cloud" ? "Synced to your account" : "On this device"}</small></span><ChevronRight /></button>
          <a className="settingsRow" href="/login"><span className="settingsIcon"><LogIn /></span><span className="settingsRowCopy"><b>{provider?.mode === "cloud" ? "Account" : "Sign in"}</b><small>{provider?.mode === "cloud" ? profile.displayName || "Manage your account" : "Sync your planner and history"}</small></span><ChevronRight /></a>
        </section>

        <h2 className="settingsSectionTitle">Preferences</h2>
        <section className="settingsGroup">
          <label className="settingsRow editable"><span className="settingsIcon"><UserRound /></span><span className="settingsRowCopy"><b>Display name</b><small>How Zest addresses you</small></span><input aria-label="Display name" maxLength={100} value={profile.displayName} placeholder="Add name" onChange={e=>setProfile({...profile,displayName:e.target.value})} onBlur={()=>saveProfile(profile)} /></label>
          <button type="button" className="settingsRow" onClick={()=>{setSheetSearch("");setSheet("timezone");}}><span className="settingsIcon"><SlidersHorizontal /></span><span className="settingsRowCopy"><b>Timezone</b></span><span className="settingsValue">{timezoneLabel}</span><ChevronRight /></button>
          <button type="button" className="settingsRow" onClick={()=>setSheet("region")}><span className="settingsIcon"><SlidersHorizontal /></span><span className="settingsRowCopy"><b>Language & region</b><small>Interface is currently English</small></span><span className="settingsValue">{localeLabel}</span><ChevronRight /></button>
          <label className="settingsRow"><span className="settingsIcon"><Bell /></span><span className="settingsRowCopy"><b>Upcoming insights</b><small>Helpful reminders inside Zest</small></span><input className="settingsToggle" type="checkbox" checked={profile.reminders} onChange={e=>saveProfile({...profile,reminders:e.target.checked})} /></label>
        </section>

        <h2 className="settingsSectionTitle">Calendar & history</h2>
        <section className="settingsGroup">
          <button type="button" className="settingsRow" onClick={()=>setSheet("calendar")}><span className="settingsIcon"><CalendarDays /></span><span className="settingsRowCopy"><b>Device calendar</b><small>Add selected Zest events to your calendar</small></span><ChevronRight /></button>
          <button type="button" className="settingsRow" onClick={()=>setSheet("retention")}><span className="settingsIcon"><Database /></span><span className="settingsRowCopy"><b>Scan history</b><small>How long scan history is kept</small></span><span className="settingsValue">{retentionLabel}</span><ChevronRight /></button>
        </section>

        <h2 className="settingsSectionTitle">Plan & usage</h2>
        <section className="settingsGroup">
          <div className="settingsRow"><span className="settingsIcon"><CreditCard /></span><span className="settingsRowCopy"><b>Monthly scans</b><small>{usage ? `${usage.scans} of ${usage.allowance} used this month` : "Loading usage…"}</small></span></div>
          <a className="settingsRow" href="/app?view=rewards"><span className="settingsIcon"><CreditCard /></span><span className="settingsRowCopy"><b>Zest Credits</b><small>View rewards and earned credits</small></span><ChevronRight /></a>
        </section>

        <h2 className="settingsSectionTitle">Privacy & data</h2>
        <section className="settingsGroup">
          <button className="settingsRow" disabled={busy||!provider} onClick={()=>run(async()=>{const blob=new Blob([JSON.stringify(await provider!.exportData(),null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="zest-snap-data.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage("Data export prepared");})}><span className="settingsIcon"><Download /></span><span className="settingsRowCopy"><b>Export my data</b><small>Download a copy of your Zest data</small></span><ChevronRight /></button>
          <button className="settingsRow dangerRow" disabled={busy||!provider} onClick={()=>setSheet("clear")}><span className="settingsIcon"><Trash2 /></span><span className="settingsRowCopy"><b>{provider?.mode==="cloud"?"Delete my account":"Clear device data"}</b><small>This cannot be undone</small></span><ChevronRight /></button>
        </section>

        <h2 className="settingsSectionTitle">Support</h2>
        <section className="settingsGroup">
          <a className="settingsRow" href={"mailto:"+productConfig.supportEmail}><span className="settingsIcon"><LifeBuoy /></span><span className="settingsRowCopy"><b>Contact support</b><small>{productConfig.supportEmail}</small></span><ChevronRight /></a>
          <a className="settingsRow" href="/privacy"><span className="settingsRowCopy"><b>Privacy</b></span><ChevronRight /></a>
          <a className="settingsRow" href="/terms"><span className="settingsRowCopy"><b>Terms</b></span><ChevronRight /></a>
        </section>
        <p className="settingsFootnote">Original uploads are not retained by Zest after processing. Calendar files you export remain under your control.</p>
        {sheet && <div className="settingsOverlay" onClick={()=>setSheet(null)}>
          <section className="settingsSheet" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}>
            <div className="settingsSheetTop">
              <div>
                <h2>{sheet==="storage"?"Storage":sheet==="timezone"?"Choose timezone":sheet==="region"?"Language & region":sheet==="retention"?"Scan history":sheet==="calendar"?"Device calendar":"Clear Zest data?"}</h2>
                {sheet==="storage"&&<p>{provider?.mode==="cloud"?"Your Zest data is synced to your signed-in account.":"Your Zest data is currently stored on this device only."}</p>}
                {sheet==="region"&&<p>Zest Snap’s interface is currently English. This setting changes regional date and time formatting.</p>}
                {sheet==="calendar"&&<p>Zest exports calendar events using standard ICS files supported by Apple Calendar, Google Calendar and Outlook.</p>}
                {sheet==="clear"&&<p>{provider?.mode==="cloud"?"This permanently deletes your Zest account and cloud data.":"This permanently clears Zest scans, planner data and preferences stored on this device."}</p>}
              </div>
              <button className="iconButton" onClick={()=>setSheet(null)} aria-label="Close"><X/></button>
            </div>
            {sheet==="storage"&&<div className="settingsStorageDetails">
              <div className="storageStatus">
                <span className="storageStatusIcon"><Database /></span>
                <span><small>Storage</small><b>{provider?.mode==="cloud"?"Cloud sync":"On this device"}</b></span>
                <strong className={provider?.mode==="cloud"?"safe":"warning"}>{provider?.mode==="cloud"?"Synced":"Not backed up"}</strong>
              </div>
              <div className="storageFacts">
                <div><span>Scans & history</span><b>{provider?.mode==="cloud"?"Synced":"Stored locally"}</b></div>
                <div><span>Planner & reminders</span><b>{provider?.mode==="cloud"?"Synced":"Stored locally"}</b></div>
                <div><span>History retention</span><b>{retentionLabel}</b></div>
                <div><span>Original uploads</span><b>Not retained</b></div>
              </div>
              <p>{provider?.mode==="cloud"?"Your Zest data stays available when you sign in on supported devices.":"Clearing app/browser data or uninstalling before signing in can remove locally stored Zest data."}</p>
              <a className="button" href="/login">{provider?.mode==="cloud"?"Manage account":"Sign in to sync"}</a>
            </div>}
            {sheet==="timezone"&&<>
              <label className="settingsSheetSearch"><Search/><input autoFocus value={sheetSearch} onChange={e=>setSheetSearch(e.target.value)} placeholder="Search city or timezone" /></label>
              <div className="settingsChoiceList">{filteredTimezones.map(([value,label])=><button key={value} onClick={()=>{saveProfile({...profile,timezone:value});setSheet(null);}}><span>{label}</span>{profile.timezone===value&&<Check/>}</button>)}</div>
            </>}
            {sheet==="region"&&<div className="settingsChoiceList">{localeOptions.map(([value,label])=><button key={value} onClick={()=>{saveProfile({...profile,locale:value});setSheet(null);}}><span>{label}</span>{profile.locale===value&&<Check/>}</button>)}</div>}
            {sheet==="retention"&&<div className="settingsChoiceList">{([[30,"30 days"],[90,"90 days"],[365,"1 year"],[0,"Until deleted"]] as const).map(([value,label])=><button key={value} onClick={()=>{saveProfile({...profile,retentionDays:value});setSheet(null);}}><span>{label}</span>{profile.retentionDays===value&&<Check/>}</button>)}</div>}
            {sheet==="calendar"&&<div className="settingsSheetActions"><a className="button" href="/app">Go to scans</a><span>Select events after a scan, then choose <b>Add selected to calendar</b>.</span></div>}
            {sheet==="clear"&&<div className="settingsSheetActions dangerActions"><button className="button alt" onClick={()=>setSheet(null)}>Cancel</button><button className="button dangerButton" disabled={busy} onClick={()=>run(async()=>{await provider!.deleteData();await new LocalDataProvider(localStorage).deleteData();window.location.assign(new URL("/app",window.location.origin).href);})}>{provider?.mode==="cloud"?"Delete account":"Clear device data"}</button></div>}
          </section>
        </div>}

      </div>
    </main>
  );
}
