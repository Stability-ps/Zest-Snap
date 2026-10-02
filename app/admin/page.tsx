import { Users, ScanLine, DollarSign, Gift, SlidersHorizontal, ShieldAlert, Mail, BarChart3, Settings, ToggleRight } from "lucide-react";
import { plans, rewardRules } from "@/lib/product-config";

const stats = [
  ["Users","0",Users],
  ["AI scans today","0",ScanLine],
  ["Revenue","$0",DollarSign],
  ["Reward credits issued","0",Gift]
] as const;

export default function Admin() {
  return <main className="adminPage">
    <aside className="adminSide">
      <div className="brand">Zest <span>Snap</span></div><small>ADMIN</small>
      <nav>
        <a className="active"><BarChart3/>Overview</a>
        <a><Users/>Users</a><a><ScanLine/>Scans & AI usage</a><a><DollarSign/>Billing</a>
        <a><Gift/>Rewards</a><a><ToggleRight/>Feature flags</a><a><Mail/>Email templates</a>
        <a><ShieldAlert/>Trust & abuse</a><a><Settings/>Settings</a>
      </nav>
    </aside>
    <section className="adminMain">
      <div className="adminTop"><div><div className="eyebrow">GLOBAL CONTROL</div><h1>Admin overview</h1><p>One place to manage usage, costs, plans, rewards, content and product controls.</p></div><button className="button"><SlidersHorizontal size={17}/> Configure product</button></div>
      <div className="adminStats">{stats.map(([label,value,Icon])=><div className="adminStat" key={label}><Icon/><span>{label}</span><b>{value}</b><small>Waiting for persistent data connection</small></div>)}</div>
      <div className="adminGrid">
        <section className="adminPanel"><h2>Plans & allowances</h2><p>Designed to become database-driven so pricing can change without a deployment.</p>{Object.values(plans).map(plan=><div className="adminRow" key={plan.id}><div><b>{plan.name}</b><small>{"$"+plan.monthlyUsd+"/month · "+plan.monthlyScans+" scans"}</small></div><button>Edit</button></div>)}</section>
        <section className="adminPanel"><h2>Rewards engine</h2><p>Useful incentives that are configurable instead of hard-coded.</p>{Object.entries(rewardRules).map(([k,v])=><div className="adminRow" key={k}><div><b>{k.replace(/([A-Z])/g," $1")}</b><small>{v} credits / bonus units</small></div><button>Edit</button></div>)}</section>
        <section className="adminPanel"><h2>Feature flags</h2><div className="flagRow"><span><b>AI scanning</b><small>Master switch for paid AI operations</small></span><em>ON</em></div><div className="flagRow"><span><b>Rewards</b><small>Credits, milestones and referrals</small></span><em>ON</em></div><div className="flagRow"><span><b>Business plan</b><small>Public availability</small></span><em>ON</em></div><div className="flagRow"><span><b>Direct calendar sync</b><small>Enable after OAuth credentials</small></span><em className="off">OFF</em></div></section>
        <section className="adminPanel"><h2>Safety & cost controls</h2><div className="adminRow"><div><b>Per-file limit</b><small>5 MB during initial launch</small></div></div><div className="adminRow"><div><b>Uncertain dates</b><small>Require user review</small></div></div><div className="adminRow"><div><b>AI usage metering</b><small>Required before public launch</small></div></div></section>
      </div>
    </section>
  </main>;
}
