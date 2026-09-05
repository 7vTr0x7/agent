import { InterviewDetailsExtractor } from "./InterviewDetailsExtractor";

describe("InterviewDetailsExtractor", () => {
  const extractor = new InterviewDetailsExtractor();

  it("extracts date, time, timezone and Google Meet link", () => {
    const result = extractor.extract({
      subject: "Interview - Frontend Engineer",
      bodyText:
        "We would like to meet on Wednesday, September 16, 2026 at 3:30 PM IST. Join: https://meet.google.com/abc-defg-hij"
    });

    expect(result.dateText).toBe("September 16, 2026");
    expect(result.timeText).toBe("3:30 PM");
    expect(result.timezone).toBe("IST");
    expect(result.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(result.meetingProvider).toBe("google-meet");
  });

  it("extracts Teams and supports ISO dates", () => {
    const result = extractor.extract({
      subject: "Technical round",
      bodyText: "2026-09-20 at 11 AM BST https://teams.microsoft.com/l/meetup-join/123"
    });

    expect(result.dateText).toBe("2026-09-20");
    expect(result.timeText).toBe("11 AM");
    expect(result.timezone).toBe("BST");
    expect(result.meetingProvider).toBe("microsoft-teams");
  });

  it("does not invent missing schedule details", () => {
    const result = extractor.extract({
      subject: "Next steps",
      bodyText: "We would like to proceed to the next round."
    });

    expect(result.dateText).toBeNull();
    expect(result.timeText).toBeNull();
    expect(result.timezone).toBeNull();
    expect(result.meetingUrl).toBeNull();
    expect(result.meetingProvider).toBeNull();
  });
});
