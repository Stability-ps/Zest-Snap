"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronRight, Copy, Link2, Plus, Share2, Users, Utensils, GraduationCap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { shareTextNatively } from "@/lib/native/share";

type SharedPlan = { id:string; name:string; kind:string; description:string; owner_id:string; created_at:string; updated_at:string };
type Invite = { id:string; plan_id:string; token:string; role:string; status:string; expires_at:string; shared_plans?:{name?:string;kind?:string}|null };

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
  const [plans,setPlans]=useState<SharedPlan[]>([]);
  const [invites,setInvites]=useState<Invite[]>([]);
  const [loading,setLoading]=useState(false);
  const [creating,setCreating]=useState(false);
  const [name,setName]=useState("");
  const [kind,setKind]=useState("family");

  const load=useCallback(async()=>{
    if(!signedIn){setPlans([]);setInvites([]);return;}
    setLoading(true);
    try{
      const db=createClient();
      const [owned,members,pending]=await Promise.all([
        db.from("shared_plans").select("id,name,kind,description,owner_id,created_at,updated_at").order("updated_at",{ascending:false}),
        db.from("shared_plan_members").select("plan_id").eq("status","active"),
        db.from("shared_plan_invites").select("id,plan_id,token,role,status,expires_at,shared_plans(name,kind)").eq("status","pending").order("created_at",{ascending:false}),
      ]);
      if(owned.error) throw owned.error;
      setPlans((owned.data||[]) as SharedPlan[]);
      setInvites((pending.data||[]) as unknown as Invite[]);
      void members;
    }catch(e){onNotice("error",e instanceof Error?e.message:"Shared plans could not be loaded.");}
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
    }catch(e){onNotice("error",e instanceof Error?e.message:"Could not create the shared plan.");}
    finally{setLoading(false);}
  }

  async function sharePlan(plan:SharedPlan){
    try{
      const db=createClient();
      const {data,error}=await db.rpc("create_shared_invite",{p_plan:plan.id,p_email:null,p_role:"editor"});
      if(error)throw error;
      const url=`${window.location.origin}/share/${data}`;
      const text=`Join “${plan.name}” on Zest Snap: ${url}`;
      if(await shareTextNatively({title:plan.name,text,url})) return;
      await navigator.clipboard.writeText(url);
      onNotice("success","Invite link copied.");
    }catch(e){onNotice("error",e instanceof Error?e.message:"Could not create an invite.");}
  }

  if(!signedIn) return <section className="sharedRoot"><div className="sharedHero"><div><h1>Shared</h1><p>Plan together without filling your calendar with copies.</p></div></div><div className="sharedEmpty"><Share2/><h2>Share plans with your people</h2><p>Sign in to create family, class, team, timetable and meal plans that stay updated for everyone.</p><button className="button" onClick={onSignIn}>Sign in to start sharing</button></div></section>;

  return <section className="sharedRoot">
    <div className="sharedHero"><div><h1>Shared</h1><p>Events, plans and To-Dos you organise together.</p></div><button className="plannerFab" onClick={()=>setCreating(true)} aria-label="Create shared plan"><Plus/></button></div>
    {invites.length>0&&<><h2 className="sharedSectionTitle">Invitations</h2><div className="sharedList">{invites.map(i=><a className="sharedCard" key={i.id} href={`/share/${i.token}`}><span className="sharedIcon"><Link2/></span><span><b>{i.shared_plans?.name||"Shared plan"}</b><small>Invitation · {i.role}</small></span><ChevronRight/></a>)}</div></>}
    <h2 className="sharedSectionTitle">My groups</h2>
    {loading&&!plans.length?<div className="sharedEmpty compact"><p>Loading shared plans…</p></div>:plans.length?<div className="sharedList">{plans.map(plan=>{const meta=kinds.find(k=>k.value===plan.kind);const Icon=meta?.icon||Users;return <div className="sharedCard" key={plan.id}><span className="sharedIcon"><Icon/></span><a className="sharedCardMain" href={`/shared/${plan.id}`}><b>{plan.name}</b><small>{meta?.label||"Shared"} plan</small></a><button className="iconButton" onClick={()=>sharePlan(plan)} aria-label={`Invite people to ${plan.name}`}><Share2/></button></div>})}</div>:<div className="sharedEmpty compact"><Users/><h2>No shared plans yet</h2><p>Create one for family, a class, team, trip, timetable or meals.</p><button className="button alt" onClick={()=>setCreating(true)}><Plus/> Create group</button></div>}
    {creating&&<div className="sharedModal" onClick={()=>setCreating(false)}><section className="sharedSheet" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}><div className="sheetHandle"/><h2>Create a shared plan</h2><p>Keep it focused. You can invite people after creating it.</p><label><span>Name</span><input autoFocus maxLength={160} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Sibande family"/></label><div className="sharedKindGrid">{kinds.map(k=>{const Icon=k.icon;return <button key={k.value} className={kind===k.value?"active":""} onClick={()=>setKind(k.value)}><Icon/><span>{k.label}</span></button>})}</div><button className="button" disabled={loading||!name.trim()} onClick={createPlan}>Create plan</button></section></div>}
  </section>;
}
