"use client";
import { useEffect,useState } from "react";
import { CalendarDays, Check, Loader2, Users } from "lucide-react";
import Link from "next/link";
import { useParams,useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { googleCalendarUrl } from "@/lib/google-calendar";

type Preview={plan_name:string;plan_kind:string;role:string;expires_at:string;item:any};

export default function SharedInvitePage(){
 const params=useParams<{token:string}>(),router=useRouter();
 const token=String(params.token||"");
 const [preview,setPreview]=useState<Preview|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{fetch(`/api/share/${encodeURIComponent(token)}`,{cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error("This invitation is no longer available.");const b=await r.json();setPreview(b.invite);}).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[token]);
 async function accept(){
   setBusy(true);setError("");
   try{
    const db=createClient();const {data:{user}}=await db.auth.getUser();
    if(!user){router.push(`/login?next=${encodeURIComponent("/share/"+token)}`);return;}
    const r=await fetch(`/api/share/${encodeURIComponent(token)}`,{method:"POST"});const b=await r.json();
    if(!r.ok)throw new Error(b.error||"Could not accept this invitation.");
    router.push(`/shared/${b.planId}`);
   }catch(e){setError(e instanceof Error?e.message:"Could not accept this invitation.");setBusy(false);}
 }
 function addCalendar(){
  const x=preview?.item;if(!x?.start_date)return;
  const event={title:x.title||preview?.plan_name||"Shared event",description:x.description||"",startDate:x.start_date||"",endDate:x.end_date||x.start_date||"",startTime:x.start_time?String(x.start_time).slice(0,5):"",endTime:x.end_time?String(x.end_time).slice(0,5):"",allDay:Boolean(x.all_day),timezone:x.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC",location:x.location||"",confidence:1,confidenceReason:"Shared by a Zest user",sourceText:"",category:"event" as const};
  window.location.assign(googleCalendarUrl(event,event.timezone));
 }
 if(loading)return <main className="shareLanding"><Loader2 className="spin"/><p>Opening invitation…</p></main>;
 if(error&&!preview)return <main className="shareLanding"><div className="shareInviteCard"><h1>Invitation unavailable</h1><p>{error}</p><Link className="button" href="/app">Go to Zest Snap</Link></div></main>;
 const item=preview?.item;
 return <main className="shareLanding"><section className="shareInviteCard"><div className="shareInviteIcon"><Users/></div><span className="eyebrow">SHARED WITH YOU</span><h1>{preview?.plan_name}</h1><p>You’ve been invited as {preview?.role==="editor"?"a collaborator":"a viewer"}.</p>{item&&<div className="shareEventPreview"><b>{item.title}</b>{item.start_date&&<span><CalendarDays/> {item.start_date}{item.start_time?` · ${String(item.start_time).slice(0,5)}`:""}</span>}{item.location&&<small>{item.location}</small>}</div>}<button className="button" disabled={busy} onClick={accept}>{busy?<Loader2 className="spin"/>:<Check/>} Accept in Zest</button>{item?.start_date&&<button className="button alt" onClick={addCalendar}><CalendarDays/> Add to my calendar</button>}{error&&<p className="supportFormError" role="alert">{error}</p>}<small className="shareInviteFoot">You can view the invitation before signing in. A Zest account is only needed for live shared updates.</small></section></main>;
}
