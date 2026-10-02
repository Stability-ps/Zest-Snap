import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_DATA_URL_LENGTH = 8_000_000;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentType: { type: "string" },
    summary: { type: "string" },
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          startDate: { type: "string", description: "YYYY-MM-DD or empty string" },
          endDate: { type: "string", description: "YYYY-MM-DD or empty string" },
          startTime: { type: "string", description: "HH:mm 24-hour local time or empty string" },
          endTime: { type: "string", description: "HH:mm 24-hour local time or empty string" },
          timezone: { type: "string" },
          location: { type: "string" },
          description: { type: "string" },
          allDay: { type: "boolean" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          confidenceReason: { type: "string" },
          sourceText: { type: "string" },
          category: {
            type: "string",
            enum: ["appointment","meeting","deadline","travel","payment","school","event","other"]
          }
        },
        required: [
          "title","startDate","endDate","startTime","endTime","timezone","location",
          "description","allDay","confidence","confidenceReason","sourceText","category"
        ]
      }
    },
    warnings: { type: "array", items: { type: "string" } }
  },
  required: ["documentType","summary","events","warnings"]
};

function extractOutputText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const chunks: string[] = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("");
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI service is not configured yet." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const dataUrl = body?.dataUrl;
  const mimeType = body?.mimeType;
  const fileName = body?.fileName ?? "upload";
  const locale = body?.locale ?? "en";
  const timezone = body?.timezone ?? "UTC";

  if (typeof dataUrl !== "string" || typeof mimeType !== "string") {
    return NextResponse.json({ error: "Missing file data." }, { status: 400 });
  }
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    return NextResponse.json({ error: "This file is too large for the current scanner. Please use a smaller file." }, { status: 413 });
  }
  if (!mimeType.startsWith("image/") && mimeType !== "application/pdf") {
    return NextResponse.json({ error: "Zest Snap currently accepts images and PDFs." }, { status: 415 });
  }

  const mediaPart = mimeType === "application/pdf"
    ? { type: "input_file", filename: fileName, file_data: dataUrl }
    : { type: "input_image", image_url: dataUrl, detail: "high" };

  const instructions = [
    "You are Zest Snap, a global date and event extraction engine.",
    "Extract every actionable date, deadline, appointment, meeting, payment due date, travel item, school item, or event found in the supplied content.",
    "The user locale is " + locale + " and timezone is " + timezone + ".",
    "Never guess an ambiguous numeric date. If 03/04/2026 could mean two dates, lower confidence and add a warning unless surrounding text resolves it.",
    "For relative deadlines such as 'within 10 business days', calculate only when the anchor date and jurisdiction-free business-day interpretation are clear. Otherwise add a warning.",
    "If a time is missing, mark the event allDay=true and leave startTime/endTime empty.",
    "If an end date is missing, use the same date as startDate.",
    "Keep sourceText short and quote only enough source text to explain the extraction.",
    "Do not invent locations, times or dates."
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        instructions,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: "Find all actionable dates and events in this file." },
            mediaPart
          ]
        }],
        text: {
          format: {
            type: "json_schema",
            name: "zest_snap_events",
            strict: true,
            schema
          }
        }
      })
    });

    const rawPayload = await response.text();
    let payload: any = null;
    try {
      payload = rawPayload ? JSON.parse(rawPayload) : null;
    } catch {
      console.error("OpenAI extraction returned a non-JSON response", response.status);
      return NextResponse.json(
        { error: "We could not analyse this file right now. Please try again." },
        { status: 502 }
      );
    }

    if (!response.ok) {
      console.error("OpenAI extraction failed", payload?.error?.message || response.statusText);
      return NextResponse.json(
        { error: "We could not analyse this file right now. Please try again." },
        { status: 502 }
      );
    }

    const text = extractOutputText(payload);
    try {
      const result = JSON.parse(text);
      return NextResponse.json(result);
    } catch {
      console.error("OpenAI returned unparsable structured output");
      return NextResponse.json(
        { error: "The scan completed, but the result could not be read. Please try again." },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("Extraction request failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { error: "We could not scan this file right now. Please try again." },
      { status: 500 }
    );
  }
}
