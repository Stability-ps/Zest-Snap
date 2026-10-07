import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseVoicePlanInput, voicePlanInstructions } from "@/lib/voice-plan";
import { validateExtraction } from "@/lib/extraction-validation";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentType: { type: "string", enum: ["event","schedule","timetable","exam_timetable","task_list","school_notice","meal_schedule","travel","other"] },
    summary: { type: "string" },
    events: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          startTime: { type: "string" },
          endTime: { type: "string" },
          timezone: { type: "string" },
          location: { type: "string" },
          description: { type: "string" },
          allDay: { type: "boolean" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          confidenceReason: { type: "string" },
          sourceText: { type: "string" },
          dayOfWeek: { type: "string" },
          recurrence: { type: "string", enum: ["none", "weekly"] },
          category: { type: "string", enum: ["appointment","meeting","deadline","travel","payment","school","event","other"] },
        },
        required: ["title","startDate","endDate","startTime","endTime","timezone","location","description","allDay","confidence","confidenceReason","sourceText","dayOfWeek","recurrence","category"],
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["documentType","summary","events","warnings"],
};

function outputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  return (payload?.output ?? []).flatMap((item: any) => item?.content ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
}

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin)
    return NextResponse.json({ error: "Please plan from Zest Snap." }, { status: 403 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Plan with Zest is temporarily unavailable." }, { status: 503 });

  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to use Plan with Zest." }, { status: 401 });

  let input;
  try {
    input = parseVoicePlanInput(await req.json());
  } catch (e) {
    const code = e instanceof Error ? e.message : "invalid_text";
    return NextResponse.json({ error: code === "invalid_timezone" ? "Check your timezone in Settings." : "Say or type a short plan first." }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(25000),
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        store: false,
        max_output_tokens: 6000,
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        instructions: voicePlanInstructions(input),
        input: [{ role: "user", content: [{ type: "input_text", text: input.text }] }],
        text: { format: { type: "json_schema", name: "zest_voice_plan", strict: true, schema } },
      }),
    });
  } catch {
    return NextResponse.json({ error: "Zest is taking too long. Try again." }, { status: 504 });
  }

  const raw = await response.text();
  let payload: any;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
  if (!response.ok || !payload) return NextResponse.json({ error: "Zest could not organise that plan. Try again." }, { status: 502 });

  try {
    const result = validateExtraction(JSON.parse(outputText(payload)));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Zest could not read that plan safely. Try saying it another way." }, { status: 502 });
  }
}
