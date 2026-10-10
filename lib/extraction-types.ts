export type ExtractedEvent = {
  title: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
  location: string;
  description: string;
  allDay: boolean;
  confidence: number;
  confidenceReason: string;
  sourceText: string;
  dayOfWeek?: string;
  recurrence?: "none" | "weekly";
  /** Set on review-screen suggestions (lib/scan-extras.ts) so they save as that Planner type. Never from the AI. */
  plannerType?: "event" | "task" | "deadline";
  category:
    | "appointment"
    | "meeting"
    | "deadline"
    | "travel"
    | "payment"
    | "school"
    | "event"
    | "other";
};

export type ExtractionResult = {
  documentType: "event" | "schedule" | "timetable" | "exam_timetable" | "task_list" | "school_notice" | "meal_schedule" | "travel" | "other";
  summary: string;
  events: ExtractedEvent[];
  warnings: string[];
};
