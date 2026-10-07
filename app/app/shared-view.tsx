"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronRight, Link2, Plus, Share2, Users, Utensils, GraduationCap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { shareTextNatively } from "@/lib/native/share";
import { sharedErrorMessage } from "@/lib/shared-errors";

type SharedPlan = { id:string; name:string; kind:string; description:string; owner_id:string; created_at:string; updated_at:string };
type Invite = { id:string; plan_id:string; token:string; role:string; status:string; expires_at:string; created_by:string; invited_email:string|null; shared_plans?:{name?:string;kind?:string}|null };

const kinds = [
  { value:"family", label:"Family", icon:Users },
  { value:"class", label:"Class", icon:GraduationCap },
  { value:"team", label:"Team", icon:Users },
  { value:"trip", label:"Trip", icon:CalendarDays },
  { value:"timetable", label:"Timetable", icon:GraduationCap },
  { value:"meals", label:"Meals", icon:Utensils },
] as const;

export default function SharedView({ signedIn, onSignIn, onNotice }:{
  signedIn:boolean;
  onSignIn:()=>void;
  onNotice:(kind:"success"|"error",message:string)=>void;
}) {
  const [plans,setPlans]=useState<SharedPlan[]>(()=>{
    if(typeof window==="undefined")return [];
    try{return JSON.parse(localStorage.getItem("zest:shared-plans-cache")||"[]") as SharedPlan[];}catch{return [];}
  });
  const [invites,setInvites]=useState<Invite[]>([]);
  const [loading,setLoading]=useState(false);
  const [loadError,setLoadError]=useState("");
  const [creating,setCreating]=useState(false);
  const [name,setName]=useState("");
  const [kind,setKind]=useState("family");
  const [email,setEmail]=useState("");
  const [invitePlan,setInvitePlan]=useState<SharedPlan|null>(null);

  const load=useCallback(async()=>{
    if(!signedIn){setPlans([]);setInvites([]);return;}
    setLoading(true);
    setLoadError("");
    try{
      const db=createClient();
      const request=Promise.all([
        db.from("shared_plans").select("id,name,kind,description,owner_id,created_at,updated_at").order("updated_at",{ascending:false}),
        db.from("shared_plan_invites").select("id,plan_id,token,role,status,expires_at,created_by,invited_email,shared_plans(name,kind)").eq("status","pending").gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}),
        db.auth.getUser(),
      ]);
      const timeout=new Promise<never>((_,reject)=>{
        window.setTimeout(()=>reject(new Error("shared_load_timeout")),12000);
      });
      const [owned,pending,{data:{user}}]=await Promise.race([request,timeout]);
      if(owned.error) throw owned.error;
      const plans=(owned.data||[]) as SharedPlan[];
      setPlans(plans);
      try{localStorage.setItem("zest:shared-plans-cache",JSON.stringify(plans));}catch{}
      // Invites the user created are links they sent out, not invitations for them; skip plans they already belong to.
      const joined=new Set(plans.map(p=>p.id));
      setInvites(((pending.data||[]) as unknown as Invite[]).filter(i=>i.invited_email&&i.created_by!==user?.id&&!joined.has(i.plan_id)));
    }catch(e){
      const message=e instanceof Error&&e.message==="shared_load_timeout"
        ?"Shared plans are taking too long to load. Check your connection and try again."
        :sharedErrorMessage(e,"Shared plans could not be loaded.");
      setLoadError(message);
      onNotice("error",message);
    }
    finally{setLoading(false);}
  },[signedIn,onNotice]);

  useEffect(()=>{load();},[load]);

  async function createPlan(){
    if(!signedIn)return onSignIn();
    if(!name.trim())return onNotice("error","Give this shared plan a name.");
    setLoading(true);
    try{
      const db=createClient();
      const {error}=await db.rpc("create_shared_plan",{p_name:name.trim(),p_kind:kind});
      if(error)throw error;
      setName("");setCreating(false);await load();
      onNotice("success","Shared plan created.");
    }catch(e){onNotice("error",sharedErrorMessage(e,"Could not create the shared plan."));}
    finally{setLoading(false);}
  }

  async function inviteByEmail(){
    if(!invitePlan||!email.trim())return;
    try{
      const db=createClient();
      const invited=email.trim();
      const {data,error}=await db.rpc("create_shared_invite",{p_plan:invitePlan.id,p_email:invited,p_role:"editor"});
      if(error)throw error;
      // Zest does not send email itself, so hand the personal link to the share sheet (or clipboard).
      const url=`https://app.zestsnap.app/share/${data}`;
      const text=`Join “${invitePlan.name}” on Zest Snap (sign in as ${invited}): ${url}`;
      setEmail("");setInvitePlan(null);
      if(await shareTextNatively({title:invitePlan.name,text,url}))return onNotice("success","Invitation for "+invited+" is ready to send.");
      await navigator.clipboard.writeText(text).catch(()=>undefined);
      onNotice("success","Invitation for "+invited+" copied. Send it to them — only that address can accept it.");
    }catch(e){onNotice("error",sharedErrorMessage(e,"Could not create the invitation."));}
  }

  async function sharePlan(plan:SharedPlan){
    try{
      const db=createClient();
      const {data,error}=await db.rpc("create_shared_invite",{p_plan:plan.id,p_email:null,p_role:"editor"});
      if(error)throw error;
      const url=`https://app.zestsnap.app/share/${data}`;
      const text=`Join “${plan.name}” on Zest Snap: ${url}`;
      if(await shareTextNatively({title:plan.name,text,url})) return;
      await navigator.clipboard.writeText(url);
      onNotice("success","Invite link copied.");
    }catch(e){onNotice("error",sharedErrorMessage(e,"Could not create an invite."));}
  }

  if(!signedIn) return <section className="sharedRoot"><div className="sharedHero"><div><h1>Shared</h1><p>Plan together without filling your calendar with copies.</p></div></div><div className="sharedEmpty"><Share2/><h2>Share plans with your people</h2><p>Sign in to create family, class, team, timetable and meal plans that stay updated for everyone.</p><button className="button" onClick={onSignIn}>Sign in to start sharing</button></div></section>;

  return <section className="sharedRoot">
    <div className="sharedHero"><div><h1>Shared</h1><p>Events, plans and To-Dos you organise together.</p></div><button className="plannerFab" onClick={()=>setCreating(true)} aria-label="Create shared plan"><Plus/></button></div>
    {invites.length>0&&<><h2 className="sharedSectionTitle">Invitations</h2><div className="sharedList">{invites.map(i=><a className="sharedCard" key={i.id} href={`/share/${i.token}`}><span className="sharedIcon"><Link2/></span><span><b>{i.shared_plans?.name||"Shared plan"}</b><small>Invitation · {i.role}</small></span><ChevronRight/></a>)}</div></>}
    <h2 className="sharedSectionTitle">My groups</h2>
    {loading&&!plans.length?null:loadError&&!plans.length?<div className="sharedEmpty compact"><Users/><h2>Couldn’t load shared plans</h2><p>{loadError}</p><button className="button alt" onClick={load}>Try again</button></div>:plans.length?<div className="sharedList">{plans.map(plan=>{const meta=kinds.find(k=>k.value===plan.kind);const Icon=meta?.icon||Users;return <div className="sharedCard" key={plan.id}><span className="sharedIcon"><Icon/></span><a className="sharedCardMain" href={`/shared/${plan.id}`}><b>{plan.name}</b><small>{meta?.label||"Shared"} plan</small></a><button className="iconButton" onClick={()=>setInvitePlan(plan)} aria-label={`Invite people to ${plan.name}`}><Share2/></button></div>})}</div>:<div className="sharedEmpty compact"><Users/><h2>No shared plans yet</h2><p>Create one for family, a class, team, trip, timetable or meals.</p><button className="button alt" onClick={()=>setCreating(true)}><Plus/> Create group</button></div>}
    {invitePlan&&<div className="sharedModal" onClick={()=>setInvitePlan(null)}><section className="sharedSheet" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}><div className="sheetHandle"/><h2>Invite to {invitePlan.name}</h2><p>Share a link with the whole group, or create a personal link only one email address can accept.</p><button className="button" onClick={()=>sharePlan(invitePlan)}><Share2/> Share invite link</button><label><span>Email invitation</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/></label><button className="button alt" disabled={!email.trim()} onClick={inviteByEmail}>Create and send personal invite</button></section></div>}
    {creating&&<div className="sharedModal" onClick={()=>setCreating(false)}><section className="sharedSheet" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}><div className="sheetHandle"/><h2>Create a shared plan</h2><p>Keep it focused. You can invite people after creating it.</p><label><span>Name</span><input autoFocus maxLength={160} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Sibande family"/></label><div className="sharedKindGrid">{kinds.map(k=>{const Icon=k.icon;return <button key={k.value} className={kind===k.value?"active":""} onClick={()=>setKind(k.value)}><Icon/><span>{k.label}</span></button>})}</div><button className="button" disabled={loading||!name.trim()} onClick={createPlan}>Create plan</button></section></div>}
  </section>;
}
