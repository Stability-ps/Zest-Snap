import { Globe2, Bell, CalendarDays, Shield, CreditCard, Gift, ChevronRight } from "lucide-react";
import { productConfig } from "@/lib/product-config";

const rows = [
  [Globe2,"Language, region & timezone","Automatic now · Change anytime"],
  [CalendarDays,"Calendar connections","Google · Apple · Outlook"],
  [Bell,"Notifications","Smart reminders · Weekly recap"],
  [Gift,"Rewards & referrals","Credits, milestones and referral bonuses"],
  [CreditCard,"Plan & usage","Free · 0 of 10 AI scans used"],
  [Shield,"Privacy & data","Scan history, retention and deletion controls"]
] as const;

export default function Settings() {
  return <main className="settingsPage">
    <div className="settingsWrap">
      <a href="/app" className="textButton">← Back to Zest Snap</a>
      <div className="brand" style={{marginTop:24}}>Zest <span>Snap</span></div>
      <h1>Settings</h1><p>Control how Zest Snap works for you.</p>
      <div className="settingsList">{rows.map(([Icon,title,desc])=><button key={title}><div className="settingsIcon"><Icon/></div><span><b>{title}</b><small>{desc}</small></span><ChevronRight/></button>)}</div>
      <div className="supportPanel"><b>Need help?</b><p>Contact {productConfig.supportEmail}</p></div>
    </div>
  </main>;
}
