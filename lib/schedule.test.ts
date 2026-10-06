import { describe,expect,it } from "vitest";
import { firstWeekdayOnOrAfter,materializeWeeklySchedule,weeklyOccurrences } from "./schedule";
import type { ExtractedEvent } from "./extraction-types";

const event:ExtractedEvent={title:"Accounting",startDate:"",endDate:"",startTime:"09:00",endTime:"10:00",timezone:"Africa/Johannesburg",location:"Room 1",description:"",allDay:false,confidence:1,confidenceReason:"clear",sourceText:"",dayOfWeek:"monday",recurrence:"weekly",category:"school"};

describe("schedule helpers",()=>{
 it("finds the first requested weekday in a term",()=>expect(firstWeekdayOnOrAfter("2026-10-06","monday")).toBe("2026-10-12"));
 it("does not invent dates until the user supplies a range",()=>expect(materializeWeeklySchedule([event],"2026-10-06","2026-10-31")[0].startDate).toBe("2026-10-12"));
 it("expands weekly occurrences only through the supplied end date",()=>expect(weeklyOccurrences(event,"2026-10-06","2026-10-31")).toEqual(["2026-10-12","2026-10-19","2026-10-26"]));
 it("rejects an invalid range",()=>expect(()=>materializeWeeklySchedule([event],"2026-11-01","2026-10-01")).toThrow());
});
