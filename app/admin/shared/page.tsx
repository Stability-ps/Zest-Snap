import { adminRpc, iso } from "@/lib/admin/server";
import { fmtPercent, ratio, humanize } from "@/lib/admin/format";
import { BarList, Card, LoadError, PageHeader, Stats } from "../_components/ui";
import { readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata={title:"Shared · Admin"};

export default async function SharedAdmin({searchParams}:{searchParams:SearchParams}){
 const range=rangeFrom(await readParams(searchParams));
 const res=await adminRpc<any>("admin_shared_usage",{p_from:iso(range.from),p_to:iso(range.to)});
 const head=<PageHeader title="Shared" description={`Shared plans, invitations and collaboration · ${range.label}`}/>;
 if(res.error)return <>{head}<Card><LoadError error={res.error} retryHref="/admin/shared"/></Card></>;
 const d=res.data||{},accepted=Number(d.invites_accepted||0),created=Number(d.invites_created||0);
 return <>{head}<Card title="Collaboration"><Stats items={[
  {label:"Plans created",value:Number(d.plans_created||0)},
  {label:"Active plans",value:Number(d.active_plans||0)},
  {label:"Members joined",value:Number(d.members_joined||0)},
  {label:"Invites created",value:created},
  {label:"Invites accepted",value:accepted},
  {label:"Invite conversion",value:fmtPercent(ratio(accepted,created))},
  {label:"Shared items created",value:Number(d.items_created||0)},
 ]}/></Card><Card title="Plans by type"><BarList data={Object.entries(d.by_kind||{}).map(([k,v])=>({key:k,label:humanize(k),value:Number(v)}))} empty="No shared plans in this period."/></Card></>;
}
