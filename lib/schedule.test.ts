import assert from "node:assert/strict";
import test from "node:test";
import { firstWeekdayOnOrAfter,materializeWeeklySchedule,weeklyOccurrences } from "./schedule";
import type { ExtractedEvent } from "./extraction-types";

const event:ExtractedEvent={title:"Accounting",startDate:"",endDate:"",startTime:"09:00",endTime:"10:00",timezone:"Africa/Johannesburg",location:"Room 1",description:"",allDay:false,confidence:1,confidenceReason:"clear",sourceText:"",dayOfWeek:"monday",recurrence:"weekly",category:"school"};

test("finds the first requested weekday in a term",()=>assert.equal(firstWeekdayOnOrAfter("2026-10-06","monday"),"2026-10-12"));
test("does not invent dates until the user supplies a range",()=>assert.equal(materializeWeeklySchedule([event],"2026-10-06","2026-10-31")[0].startDate,"2026-10-12"));
test("expands weekly occurrences only through the supplied end date",()=>assert.deepEqual(weeklyOccurrences(event,"2026-10-06","2026-10-31"),["2026-10-12","2026-10-19","2026-10-26"]));
test("rejects an invalid range",()=>assert.throws(()=>materializeWeeklySchedule([event],"2026-11-01","2026-10-01")));
