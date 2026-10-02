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
  category: "appointment" | "meeting" | "deadline" | "travel" | "payment" | "school" | "event" | "other";
};

export type ExtractionResult = {
  documentType: string;
  summary: string;
  events: ExtractedEvent[];
  warnings: string[];
};
