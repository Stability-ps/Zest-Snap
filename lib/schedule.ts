import type { ExtractedEvent } from "./extraction-types";

const DAYS:Record<string,number>={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};

export function firstWeekdayOnOrAfter(startDate:string,dayOfWeek:string){
  const target=DAYS[dayOfWeek.toLowerCase()];
  if(target===undefined)return "";
  const start=new Date(startDate+"T12:00:00Z");
  if(Number.isNaN(start.getTime()))return "";
  const delta=(target-start.getUTCDay()+7)%7;
  start.setUTCDate(start.getUTCDate()+delta);
  return start.toISOString().slice(0,10);
}

export function materializeWeeklySchedule(events:ExtractedEvent[],rangeStart:string,rangeEnd:string){
  if(!rangeStart||!rangeEnd||rangeEnd<rangeStart)throw new Error("Choose a valid start and end date.");
  return events.map(event=>{
    if(event.startDate)return event;
    if(event.recurrence!=="weekly"||!event.dayOfWeek)return event;
    const first=firstWeekdayOnOrAfter(rangeStart,event.dayOfWeek);
    return {...event,startDate:first,endDate:first,description:[event.description,`Repeats weekly until ${rangeEnd}`].filter(Boolean).join("\n")};
  });
}

export function weeklyOccurrences(event:ExtractedEvent,rangeStart:string,rangeEnd:string){
  const first=event.startDate||firstWeekdayOnOrAfter(rangeStart,event.dayOfWeek||"");
  if(!first)return [];
  const out:string[]=[];
  const cursor=new Date(first+"T12:00:00Z"),end=new Date(rangeEnd+"T12:00:00Z");
  while(cursor<=end&&out.length<370){out.push(cursor.toISOString().slice(0,10));cursor.setUTCDate(cursor.getUTCDate()+7);}
  return out;
}
