import { Temporal } from "@js-temporal/polyfill";
import { DATE_RANGE_MESSAGE, isValidDate } from "./dates";

export type PlannerItemType = "event" | "task" | "deadline" | "reminder";
export type PlannerItemStatus = "open" | "completed" | "cancelled";
export type PlannerSource = "manual" | "scan" | "import";
export type PlannerItem = {
  id:string; type:PlannerItemType; title:string; description:string;
  startDate:string; endDate:string; startTime:string; endTime:string;
  dueDate:string; dueTime:string; allDay:boolean; timezone:string; location:string;
  status:PlannerItemStatus; source:PlannerSource; sourceScanId?:string; completedAt?:string;
  createdAt:string; updatedAt:string;
  externalProvider?:"google"; externalId?:string; externalUrl?:string|null; externalCalendarName?:string; externalCalendarPrimary?:boolean;
  googleEventId?:string; googleSyncedAt?:string;
};
export type ReminderPreset="at_time"|"5m"|"15m"|"30m"|"1h"|"1d"|"1w"|"custom";
export type ReminderDraft={preset:ReminderPreset;customMinutes?:number;allDayTime?:string};
const DATE=/^\d{4}-\d{2}-\d{2}$/; const TIME=/^\d{2}:\d{2}$/;
export function todayDate(timezone:string,now=Temporal.Now.instant()){return now.toZonedDateTimeISO(timezone||"UTC").toPlainDate().toString();}
export function plannerReferenceDate(item:Pick<PlannerItem,"type"|"startDate"|"dueDate">){return item.type==="task"||item.type==="deadline"?item.dueDate||item.startDate:item.startDate;}
export function plannerReferenceTime(item:Pick<PlannerItem,"type"|"startTime"|"dueTime"|"allDay">){if(item.allDay)return "";return item.type==="task"||item.type==="deadline"?item.dueTime||item.startTime:item.startTime;}
export function plannerInstant(item:Pick<PlannerItem,"type"|"startDate"|"startTime"|"dueDate"|"dueTime"|"allDay"|"timezone">){
 const date=plannerReferenceDate(item),time=plannerReferenceTime(item); if(!date||!DATE.test(date)||item.allDay||!time)return null;
 if(!TIME.test(time))throw new Error("Enter a valid time.");
 return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(item.timezone||"UTC",{disambiguation:"reject"}).toInstant();
}
export function validatePlannerItem(item:PlannerItem){
 if(!item.title.trim()||item.title.length>500)throw new Error("Enter a title.");
 const date=plannerReferenceDate(item); if(!isValidDate(date))throw new Error(DATE_RANGE_MESSAGE);
 for(const extra of [item.startDate,item.endDate,item.dueDate])if(extra&&!isValidDate(extra))throw new Error(DATE_RANGE_MESSAGE);
 try{Temporal.PlainDate.from(date);new Intl.DateTimeFormat("en",{timeZone:item.timezone||"UTC"});}catch{throw new Error("Choose a valid date and timezone.");}
 if(item.description.length>10000||item.location.length>2000)throw new Error("Planner details are too long.");
 if(!item.allDay&&plannerReferenceTime(item))plannerInstant(item);
 if(item.type==="event"&&item.endDate&&Temporal.PlainDate.compare(Temporal.PlainDate.from(item.endDate),Temporal.PlainDate.from(item.startDate))<0)throw new Error("End date must follow start date.");
}
export function reminderMinutes(d:ReminderDraft){const map:Record<string,number>={at_time:0,"5m":5,"15m":15,"30m":30,"1h":60,"1d":1440,"1w":10080};if(d.preset!=="custom")return map[d.preset];const n=Number(d.customMinutes);if(!Number.isFinite(n)||n<0||n>525600)throw new Error("Custom reminder must be between 0 minutes and 1 year.");return Math.round(n);}
export function calculateReminderAt(item:PlannerItem,draft:ReminderDraft){let instant=plannerInstant(item);if(!instant&&item.allDay){const date=plannerReferenceDate(item),time=draft.allDayTime||"09:00";if(!isValidDate(date)||!TIME.test(time))throw new Error("Choose a valid reminder time.");instant=Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(item.timezone||"UTC",{disambiguation:"reject"}).toInstant();}if(!instant)throw new Error("Timed reminders need a time. Choose a time first.");return instant.subtract({minutes:reminderMinutes(draft)}).toString();}
/**
 * Calendar-day comparisons use the user's configured timezone (the same "today" as Home and the
 * Today tab); whether a timed item has passed uses the item's own wall-clock time in its timezone.
 * The browser/device timezone is never used.
 */
export function plannerStatus(item:PlannerItem,now=Temporal.Now.instant(),userTimezone?:string):"completed"|"overdue"|"today"|"upcoming"|"past"|"open"{
 if(item.status==="completed")return "completed";
 const due=item.type==="task"||item.type==="deadline";
 let today,target;
 try{today=now.toZonedDateTimeISO(userTimezone||item.timezone||"UTC").toPlainDate();target=Temporal.PlainDate.from(plannerReferenceDate(item));}catch{return "open";}
 const cmp=Temporal.PlainDate.compare(target,today);
 if(cmp>0)return "upcoming";
 if(cmp<0)return due?"overdue":"past";
 if(item.allDay)return "today";
 try{
   const instant=plannerInstant(item);
   if(instant&&Temporal.Instant.compare(instant,now)<0)return due?"overdue":"past";
 }catch{return "open";}
 return "today";
}
export function plannerFingerprint(item:Pick<PlannerItem,"type"|"title"|"startDate"|"startTime"|"dueDate"|"dueTime"|"timezone"|"location">){const norm=(v:string)=>v.normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");return JSON.stringify([item.type,norm(item.title),plannerReferenceDate(item as PlannerItem),plannerReferenceTime({...item as PlannerItem,allDay:false}),item.timezone||"UTC",norm(item.location||"")]);}
export function monthGrid(year:number,month:number,locale:string,timezone:string){const first=Temporal.PlainDate.from({year,month,day:1}),loc=new Intl.Locale(locale||"en");const firstDay=(loc as Intl.Locale&{weekInfo?:{firstDay:number}}).weekInfo?.firstDay??7;const offset=(first.dayOfWeek-firstDay+7)%7;const fmt=new Intl.DateTimeFormat(locale||undefined,{weekday:"short",timeZone:timezone||"UTC"}),monday=new Date(Date.UTC(2023,0,2));const weekdayLabels=Array.from({length:7},(_,i)=>fmt.format(new Date(monday.getTime()+((firstDay-1+i)%7)*86400000)));const cells=[] as Array<{date:string;inMonth:boolean}>;const start=first.subtract({days:offset});for(let i=0;i<42;i++){const d=start.add({days:i});cells.push({date:d.toString(),inMonth:d.month===month});}return{weekdayLabels,cells,daysInMonth:first.daysInMonth};}
export function plannerSort<T extends PlannerItem>(items: T[]) {
 const key=(x:PlannerItem)=>plannerReferenceDate(x)+"T"+(plannerReferenceTime(x)||"00:00");
 return [...items].sort((a,b)=>key(a).localeCompare(key(b))||a.title.localeCompare(b.title));
}
/** Items on the user's "today" in their chosen timezone — shared by Home and Planner so they always agree. */
export function plannerTodayItems(items:PlannerItem[],timezone:string,now=Temporal.Now.instant()){
 const today=todayDate(timezone,now);
 return plannerSort(items.filter(x=>x.status!=="cancelled"&&plannerReferenceDate(x)===today));
}
export function isPastLocal(date:string,time:string,timezone:string){
 if(!DATE.test(date)||!TIME.test(time))return false;
 try{return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(timezone||"UTC").epochMilliseconds<Date.now()-60000;}catch{return false;}
}


/** Google events are a live read-only overlay. Matching Zest events win so the same event is never rendered twice. */
export function mergePlannerWithExternal(local: PlannerItem[], external: PlannerItem[]) {
  const activeLocal = local.filter(x => x.status !== "cancelled");
  const localPrints = new Set(activeLocal.map(plannerFingerprint));
  const linkedGoogleIds = new Set(activeLocal.map(x => x.googleEventId).filter(Boolean));
  const externalIds = new Set<string>();
  const cleanExternal = external.filter((item) => {
    if (!item.externalId || externalIds.has(item.externalId)) return false;
    externalIds.add(item.externalId);
    const googleEventId = item.externalId.includes(":") ? item.externalId.slice(item.externalId.lastIndexOf(":") + 1) : item.externalId;
    if (linkedGoogleIds.has(googleEventId)) return false;
    return !localPrints.has(plannerFingerprint(item));
  });
  return plannerSort([...local, ...cleanExternal]);
}
