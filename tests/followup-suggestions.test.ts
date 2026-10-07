import assert from "node:assert/strict";
import test from "node:test";
import { followupCandidates } from "../lib/followup-suggestions";
import type { PlannerItem } from "../lib/planner";
const base=(type:PlannerItem["type"]):PlannerItem=>({id:"1",type,title:"Dentist",description:"",startDate:"2026-10-10",endDate:"2026-10-10",startTime:"14:00",endTime:"",dueDate:"2026-10-10",dueTime:"14:00",allDay:false,timezone:"UTC",location:"",status:"open",source:"manual",createdAt:"",updatedAt:""});
test("future event gets preparation suggestion",()=>{const x=followupCandidates(base("event"),new Date("2026-10-07T10:00:00Z"));assert.equal(x[0]?.kind,"prepare")});
test("past item gets no suggestion",()=>{assert.equal(followupCandidates(base("event"),new Date("2026-10-11T10:00:00Z")).length,0)});
test("task gets due-soon suggestion",()=>{const x=followupCandidates(base("task"),new Date("2026-10-10T08:00:00Z"));assert.equal(x[0]?.kind,"deadline")});
