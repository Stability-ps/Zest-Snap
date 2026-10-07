import assert from "node:assert/strict";
import test from "node:test";
import { mealPlannerItem, timetablePlannerItems, validateTimetableSchedule } from "../lib/planning-expansion";

test("materializes weekly classes inside a term", () => {
  const items = timetablePlannerItems({
    title: "Term 4",
    termStart: "2026-10-05",
    termEnd: "2026-10-11",
    timezone: "Africa/Johannesburg",
    classes: [{ subject: "Math", weekdays: [1,3], startTime: "08:00", endTime: "09:00" }],
  });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(x => x.startDate), ["2026-10-05","2026-10-07"]);
});

test("rejects bad term range and class time", () => {
  assert.throws(() => validateTimetableSchedule({title:"T",termStart:"2026-10-10",termEnd:"2026-10-01",timezone:"UTC",classes:[{subject:"A",weekdays:[1],startTime:"09:00",endTime:"08:00"}]}));
});

test("meal entry becomes a planner event", () => {
  const item = mealPlannerItem({title:"Pasta",mealDate:"2026-10-08",mealType:"dinner",startTime:"18:30"},"UTC");
  assert.equal(item.title,"Pasta");
  assert.equal(item.allDay,false);
  assert.equal(item.startTime,"18:30");
});
