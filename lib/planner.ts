import { Temporal } from "@js-temporal/polyfill";

export type PlannerItemType = "event" | "task" | "deadline" | "reminder";
export type PlannerItemStatus = "open" | "completed" | "cancelled";
export type PlannerSource = "manual" | "scan" | "import";
export type PlannerItem = {
  id:string; type:PlannerItemType; title:string; description:string;
  startDate:string; endDate:string; startTime:string; endTime:string;
  dueDate:string; dueTime:string; allDay:boolean; timezone:string; location:string;
  status:PlannerItemStatus; source:PlannerSource; sourceScanId?:string; completedAt?:string;
  createdAt:string; updatedAt:string;
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
 const date=plannerReferenceDate(item); if(!DATE.test(date))throw new Error("Choose a valid date.");
 try{Temporal.PlainDate.from(date);new Intl.DateTimeFormat("en",{timeZone:item.timezone||"UTC"});}catch{throw new Error("Choose a valid date and timezone.");}
 if(item.description.length>10000||item.location.length>2000)throw new Error("Planner details are too long.");
 if(!item.allDay&&plannerReferenceTime(item))plannerInstant(item);
 if(item.type==="event"&&item.endDate&&Temporal.PlainDate.compare(Temporal.PlainDate.from(item.endDate),Temporal.PlainDate.from(item.startDate))<0)throw new Error("End date must follow start date.");
}
export function reminderMinutes(d:ReminderDraft){const map:Record<string,number>={at_time:0,"5m":5,"15m":15,"30m":30,"1h":60,"1d":1440,"1w":10080};if(d.preset!=="custom")return map[d.preset];const n=Number(d.customMinutes);if(!Number.isFinite(n)||n<0||n>525600)throw new Error("Custom reminder must be between 0 minutes and 1 year.");return Math.round(n);}
export function calculateReminderAt(item:PlannerItem,draft:ReminderDraft){let instant=plannerInstant(item);if(!instant&&item.allDay){const date=plannerReferenceDate(item),time=draft.allDayTime||"09:00";if(!DATE.test(date)||!TIME.test(time))throw new Error("Choose a valid reminder time.");instant=Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(item.timezone||"UTC",{disambiguation:"reject"}).toInstant();}if(!instant)throw new Error("Timed reminders need a time. Choose a time first.");return instant.subtract({minutes:reminderMinutes(draft)}).toString();}
export function plannerStatus(item:PlannerItem,now=Temporal.Now.instant()):"completed"|"overdue"|"today"|"upcoming"|"past"|"open"{if(item.status==="completed")return "completed";let today;try{today=now.toZonedDateTimeISO(item.timezone||"UTC").toPlainDate();}catch{return "open";}const target=Temporal.PlainDate.from(plannerReferenceDate(item)),cmp=Temporal.PlainDate.compare(target,today);if((item.type==="task"||item.type==="deadline")&&cmp<0)return "overdue";if(cmp===0)return "today";if(cmp>0)return "upcoming";return "past";}
export function plannerFingerprint(item:Pick<PlannerItem,"type"|"title"|"startDate"|"startTime"|"dueDate"|"dueTime"|"timezone"|"location">){const norm=(v:string)=>v.normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");return JSON.stringify([item.type,norm(item.title),plannerReferenceDate(item as PlannerItem),plannerReferenceTime({...item as PlannerItem,allDay:false}),item.timezone||"UTC",norm(item.location||"")]);}
export function monthGrid(year:number,month:number,locale:string,timezone:string){const first=Temporal.PlainDate.from({year,month,day:1}),loc=new Intl.Locale(locale||"en");const firstDay=(loc as Intl.Locale&{weekInfo?:{firstDay:number}}).weekInfo?.firstDay??7;const offset=(first.dayOfWeek-firstDay+7)%7;const fmt=new Intl.DateTimeFormat(locale||undefined,{weekday:"short",timeZone:timezone||"UTC"}),monday=new Date(Date.UTC(2023,0,2));const weekdayLabels=Array.from({length:7},(_,i)=>fmt.format(new Date(monday.getTime()+((firstDay-1+i)%7)*86400000)));const cells=[] as Array<{date:string;inMonth:boolean}>;const start=first.subtract({days:offset});for(let i=0;i<42;i++){const d=start.add({days:i});cells.push({date:d.toString(),inMonth:d.month===month});}return{weekdayLabels,cells,daysInMonth:first.daysInMonth};}
