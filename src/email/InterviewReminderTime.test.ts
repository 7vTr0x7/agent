import { calculateInterviewReminderAt, parseInterviewStart } from "./InterviewReminderTime";

describe("InterviewReminderTime", () => {
  test("parses a dated IST interview and calculates a 24 hour reminder", () => {
    const details = {
      dateText: "September 16, 2026",
      timeText: "3:30 PM",
      timezone: "IST",
      meetingUrl: "https://meet.google.com/example",
      meetingProvider: "google-meet" as const
    };

    expect(parseInterviewStart(details)?.toISOString()).toBe("2026-09-16T10:00:00.000Z");
    expect(calculateInterviewReminderAt(details)?.toISOString()).toBe("2026-09-15T10:00:00.000Z");
  });

  test("refuses to invent a reminder when timezone is missing or unsupported", () => {
    const details = {
      dateText: "September 16, 2026",
      timeText: "3:30 PM",
      timezone: null,
      meetingUrl: null,
      meetingProvider: null
    };

    expect(parseInterviewStart(details)).toBeNull();
  });
});
