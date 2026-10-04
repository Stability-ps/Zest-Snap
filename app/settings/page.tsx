"use client";
import { useEffect, useMemo, useState } from "react";
import { UserRound, SlidersHorizontal, Bell, CalendarDays, Database, CreditCard, LifeBuoy, ChevronRight, LogIn, LogOut, Download, Trash2, X, Check, Search, History } from "lucide-react";
import {
  getDataProvider,
  LocalDataProvider,
  defaultProfile,
  type DataProvider,
  type Profile,
  type Usage,
} from "@/lib/data";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { clearAccountCaches, signOut } from "@/lib/session";
import { PlannerStore } from "@/lib/planner-store";
import { timezoneOptions as allTimezones, timezoneLabel as zoneLabel } from "@/lib/timezones";
import { productConfig } from "@/lib/product-config";
/** Removes Zest data from this browser only. Keeps the anonymous device id so free-trial limits still apply. */
function clearDeviceData() {
  clearAccountCaches();
  new LocalDataProvider(localStorage).deleteData();
  for (const key of ["zest-planner-v1", "zest-reminders-v1", "zest-referral-v1"]) localStorage.removeItem(key);
}
export default function Settings() {
  const [provider, setProvider] = useState<DataProvider | null>(null),
    [profile, setProfile] = useState<Profile>(defaultProfile),
    [usage, setUsage] = useState<Usage | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [sheet, setSheet] = useState<"account"|"storage"|"timezone"|"region"|"retention"|"calendar"|"clear"|"delete"|null>(null),
    [sheetSearch, setSheetSearch] = useState(""),
    [accountEmail, setAccountEmail] = useState(""),
    [googleCalendar, setGoogleCalendar] = useState<{ connected: boolean; email?: string | null }>({ connected: false });
  useEffect(() => {
    getDataProvider()
      .then(async (p) => {
        setProvider(p);
        setProfile(await p.loadProfile());
        setUsage(await p.loadUsage());
        if (p.mode === "cloud" && isSupabaseConfigured()) {
          const { data } = await createClient().auth.getUser();
          setAccountEmail(data.user?.email || "");
          fetch("/api/calendar/google/status", { cache: "no-store" })
            .then(async (r) => (r.ok ? r.json() : { connected: false }))
            .then((v) => setGoogleCalendar(v))
            .catch(() => undefined);
        }
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
  const localeOptions = [
    ["en", "Automatic"],
    ["en-ZA", "South Africa"],
    ["en-GB", "United Kingdom"],
    ["en-US", "United States"],
    ["en-CA", "Canada"],
    ["en-AU", "Australia"],
    ["en-IN", "India"],
    ["en-IE", "Ireland"],
    ["en-NZ", "New Zealand"],
    ["en-NG", "Nigeria"],
    ["en-KE", "Kenya"],
    ["en-SG", "Singapore"],
    ["en-AE", "United Arab Emirates"],
    ["de-DE", "Germany (regional formats)"],
    ["fr-FR", "France (regional formats)"],
    ["es-ES", "Spain (regional formats)"],
    ["pt-BR", "Brazil (regional formats)"],
    ["nl-NL", "Netherlands (regional formats)"],
    ["ja-JP", "Japan (regional formats)"],
  ] as const;
  const wantsZones = sheet === "timezone";
  const timezones = useMemo(() => (wantsZones ? allTimezones() : []), [wantsZones]);
  const timezoneLabel = zoneLabel(profile.timezone);
  const localeLabel = localeOptions.find(([value])=>value===profile.locale)?.[1] || "Automatic";
  const retentionLabel = profile.retentionDays===0 ? "Until deleted" : profile.retentionDays===365 ? "1 year" : profile.retentionDays+" days";
  const q = sheetSearch.trim().toLowerCase();
  const filteredTimezones = (q ? timezones.filter(([value, label]) => label.toLowerCase().includes(q) || value.toLowerCase().includes(q.replaceAll(" ", "_"))) : timezones).slice(0, 200);
  return (
    <main className="settingsPage">
      <div className="settingsWrap settingsNative">
        <a className="settingsBack" href="/app">← Zest Snap</a>
        <div className="settingsTitle"><div><h1>Settings</h1><p>{provider?.mode === "cloud" ? "Signed-in account" : "Guest mode"}</p></div>{message && <span className="settingsSaved" role="status">{message}</span>}</div>

        <h2 className="settingsSectionTitle">Account</h2>
        <section className="settingsGroup">
          <button type="button" className="settingsRow" onClick={()=>setSheet("storage")}><span className="settingsIcon"><Database /></span><span className="settingsRowCopy"><b>Storage</b><small>{provider?.mode === "cloud" ? "Synced to your account" : "On this device"}</small></span><ChevronRight /></button>
          {provider?.mode === "cloud" ? <button type="button" className="settingsRow" onClick={()=>setSheet("account")}><span className="settingsIcon"><UserRound /></span><span className="settingsRowCopy"><b>Account</b><small>{profile.displayName || accountEmail || "Manage your account"}</small></span><ChevronRight /></button> : <a className="settingsRow" href="/login"><span className="settingsIcon"><LogIn /></span><span className="settingsRowCopy"><b>Sign in</b><small>Sync your planner and history</small></span><ChevronRight /></a>}
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
          <a className="settingsRow" href="/app?view=history"><span className="settingsIcon"><History /></span><span className="settingsRowCopy"><b>History</b><small>View and search your previous scans</small></span><ChevronRight /></a>
          <button type="button" className="settingsRow" onClick={()=>setSheet("calendar")}><span className="settingsIcon"><CalendarDays /></span><span className="settingsRowCopy"><b>Calendar</b><small>{googleCalendar.connected ? `Google Calendar connected${googleCalendar.email ? ` · ${googleCalendar.email}` : ""}` : "Connect Google Calendar for one-tap adding"}</small></span><ChevronRight /></button>
          <button type="button" className="settingsRow" onClick={()=>setSheet("retention")}><span className="settingsIcon"><Database /></span><span className="settingsRowCopy"><b>Scan history</b><small>How long scan history is kept</small></span><span className="settingsValue">{retentionLabel}</span><ChevronRight /></button>
        </section>

        <h2 className="settingsSectionTitle">Plan & usage</h2>
        <section className="settingsGroup">
          <div className="settingsRow"><span className="settingsIcon"><CreditCard /></span><span className="settingsRowCopy"><b>Monthly scans</b><small>{usage ? `${usage.scans} of ${usage.allowance} used this month` : "Loading usage…"}</small></span></div>
          <a className="settingsRow" href="/app?view=rewards"><span className="settingsIcon"><CreditCard /></span><span className="settingsRowCopy"><b>Zest Credits</b><small>View rewards and earned credits</small></span><ChevronRight /></a>
        </section>

        <h2 className="settingsSectionTitle">Privacy & data</h2>
        <section className="settingsGroup">
          <button className="settingsRow" disabled={busy||!provider} onClick={()=>run(async()=>{const data=provider!.mode==="cloud"?await provider!.exportData():{...(await provider!.exportData() as object),planner:PlannerStore.guestItems(),reminders:JSON.parse(localStorage.getItem("zest-reminders-v1")||"[]")};const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="zest-snap-data.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage("Data export prepared");})}><span className="settingsIcon"><Download /></span><span className="settingsRowCopy"><b>Export my data</b><small>Download a copy of your Zest data</small></span><ChevronRight /></button>
          <button className="settingsRow dangerRow" disabled={busy||!provider} onClick={()=>setSheet("clear")}><span className="settingsIcon"><Trash2 /></span><span className="settingsRowCopy"><b>Clear device data</b><small>{provider?.mode==="cloud"?"Removes Zest data saved on this device only":"Removes everything Zest stored on this device"}</small></span><ChevronRight /></button>
          {provider?.mode==="cloud"&&<button className="settingsRow dangerRow" disabled={busy||!provider} onClick={()=>setSheet("delete")}><span className="settingsIcon"><Trash2 /></span><span className="settingsRowCopy"><b>Delete my account</b><small>Permanently deletes your account and cloud data</small></span><ChevronRight /></button>}
        </section>

        <h2 className="settingsSectionTitle">Support</h2>
        <section className="settingsGroup">
          <a className="settingsRow" href={"mailto:"+productConfig.supportEmail}><span className="settingsIcon"><LifeBuoy /></span><span className="settingsRowCopy"><b>Contact support</b><small>{productConfig.supportEmail}</small></span><ChevronRight /></a>
          <a className="settingsRow" href="/privacy"><span className="settingsRowCopy"><b>Privacy</b></span><ChevronRight /></a>
          <a className="settingsRow" href="/terms"><span className="settingsRowCopy"><b>Terms</b></span><ChevronRight /></a>
        </section>
        <p className="settingsFootnote">Original uploads are not retained by Zest after processing. Calendar access stays under your control and can be disconnected here.</p>
        {sheet && <div className="settingsOverlay" onClick={()=>setSheet(null)}>
          <section className="settingsSheet" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}>
            <div className="settingsSheetTop">
              <div>
                <h2>{sheet==="account"?"Your account":sheet==="storage"?"Storage":sheet==="timezone"?"Choose timezone":sheet==="region"?"Language & region":sheet==="retention"?"Scan history":sheet==="calendar"?"Calendar":sheet==="delete"?"Delete your account?":"Clear device data?"}</h2>
                {sheet==="account"&&<p>You’re signed in. Manage this account without signing in again.</p>}
                {sheet==="storage"&&<p>{provider?.mode==="cloud"?"Your Zest data is synced to your signed-in account.":"Your Zest data is currently stored on this device only."}</p>}
                {sheet==="region"&&<p>Zest Snap’s interface is currently English. This setting changes regional date and time formatting.</p>}
                {sheet==="calendar"&&<p>{googleCalendar.connected ? "Google Calendar is connected. Zest can add confirmed scan events directly — no file download or manual import." : "Connect Google Calendar once to add confirmed scan events directly. Until then, Zest opens a pre-filled Google Calendar event for you to save; it does not download a calendar file."}</p>}
                {sheet==="clear"&&<p>{provider?.mode==="cloud"?"This removes cached scans, Planner, reminders and preferences from this device and signs you out. Your account and cloud data are not deleted.":"This permanently clears Zest scans, Planner, reminders and preferences stored on this device. It can’t be undone."}</p>}
                {sheet==="delete"&&<p>This permanently deletes your Zest account, scans, Planner, reminders, rewards, feedback and notification subscriptions. Events you already added to another calendar app are not affected. This can’t be undone.</p>}
              </div>
              <button className="iconButton" onClick={()=>setSheet(null)} aria-label="Close"><X/></button>
            </div>
            {sheet==="account"&&<div className="settingsStorageDetails">
              <div className="storageFacts">
                <div><span>Name</span><b>{profile.displayName || "Not set"}</b></div>
                <div><span>Email</span><b>{accountEmail || "Signed-in account"}</b></div>
                <div><span>Status</span><b>Signed in</b></div>
              </div>
              <button className="button alt" disabled={busy} onClick={()=>run(async()=>{await signOut();window.location.assign(new URL("/login",window.location.origin).href);})}><LogOut size={18}/> Sign out</button>
            </div>}
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
              {provider?.mode==="cloud"?<button className="button" onClick={()=>setSheet("account")}>Manage account</button>:<a className="button" href="/login?next=%2Fsettings">Sign in to sync</a>}
            </div>}
            {sheet==="timezone"&&<>
              <label className="settingsSheetSearch"><Search/><input autoFocus value={sheetSearch} onChange={e=>setSheetSearch(e.target.value)} placeholder="Search city or timezone" /></label>
              <div className="settingsChoiceList">{filteredTimezones.map(([value,label])=><button key={value} onClick={()=>{saveProfile({...profile,timezone:value});setSheet(null);}}><span>{label}</span>{profile.timezone===value&&<Check/>}</button>)}</div>
            </>}
            {sheet==="region"&&<div className="settingsChoiceList">{localeOptions.map(([value,label])=><button key={value} onClick={()=>{saveProfile({...profile,locale:value});setSheet(null);}}><span>{label}</span>{profile.locale===value&&<Check/>}</button>)}</div>}
            {sheet==="retention"&&<div className="settingsChoiceList">{([[30,"30 days"],[90,"90 days"],[365,"1 year"],[0,"Until deleted"]] as const).map(([value,label])=><button key={value} onClick={()=>{saveProfile({...profile,retentionDays:value});setSheet(null);}}><span>{label}</span>{profile.retentionDays===value&&<Check/>}</button>)}</div>}
            {sheet==="calendar"&&<div className="settingsSheetActions">
              {provider?.mode!=="cloud" ? <a className="button" href="/login?next=%2Fsettings">Sign in to connect Google Calendar</a> : googleCalendar.connected ? <>
                <button className="button alt" disabled={busy} onClick={()=>run(async()=>{const r=await fetch("/api/calendar/google/disconnect",{method:"POST"});if(!r.ok)throw new Error("Could not disconnect Google Calendar.");setGoogleCalendar({connected:false});setMessage("Google Calendar disconnected");})}>Disconnect Google Calendar</button>
                <a className="button" href="/app">Go to scans</a>
              </> : <a className="button" href="/api/calendar/google/connect">Connect Google Calendar</a>}
              <span>After a scan, confirm the detected event and tap <b>Calendar</b>. Connected accounts are added directly; otherwise Zest opens a ready-to-save Google Calendar event.</span>
            </div>}
            {sheet==="clear"&&<div className="settingsSheetActions dangerActions"><button className="button alt" onClick={()=>setSheet(null)}>Cancel</button><button className="button dangerButton" disabled={busy} onClick={()=>run(async()=>{if(provider?.mode==="cloud")await signOut();clearDeviceData();window.location.assign(new URL("/app",window.location.origin).href);})}>Clear device data</button></div>}
            {sheet==="delete"&&<div className="settingsSheetActions dangerActions"><button className="button alt" onClick={()=>setSheet(null)}>Cancel</button><button className="button dangerButton" disabled={busy} onClick={()=>run(async()=>{await provider!.deleteData();await signOut().catch(()=>undefined);clearDeviceData();window.location.assign(new URL("/app",window.location.origin).href);})}>Delete account</button></div>}
          </section>
        </div>}

      </div>
    </main>
  );
}
