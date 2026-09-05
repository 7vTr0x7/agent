export interface InterviewDetails {
  dateText: string | null;
  timeText: string | null;
  timezone: string | null;
  meetingUrl: string | null;
  meetingProvider: "google-meet" | "microsoft-teams" | "zoom" | null;
}

const DATE_PATTERNS: readonly RegExp[] = [
  /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,|\s+)\s*\d{4})\b/i,
  /\b(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})\b/i,
  /\b(\d{4}-\d{2}-\d{2})\b/
];

const TIME_PATTERN = /\b(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\b/i;
const TIMEZONE_PATTERN = /\b(?:IST|UTC|GMT(?:[+-]\d{1,2}(?::?\d{2})?)?|CET|CEST|EST|EDT|PST|PDT|BST)\b/i;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

function cleanUrl(url: string): string {
  return url.replace(/[.,;!?]+$/g, "");
}

function providerFor(url: string): InterviewDetails["meetingProvider"] {
  const normalized = url.toLowerCase();
  if (normalized.includes("meet.google.com")) return "google-meet";
  if (normalized.includes("teams.microsoft.com") || normalized.includes("teams.live.com")) {
    return "microsoft-teams";
  }
  if (normalized.includes("zoom.us") || normalized.includes("zoom.com")) return "zoom";
  return null;
}

export class InterviewDetailsExtractor {
  extract(input: { subject: string; bodyText: string }): InterviewDetails {
    const text = `${input.subject}\n${input.bodyText}`;

    let dateText: string | null = null;
    for (const pattern of DATE_PATTERNS) {
      const match = text.match(pattern);
      if (match?.[1]) {
        dateText = match[1].replace(/\s+/g, " ").trim();
        break;
      }
    }

    const timeMatch = text.match(TIME_PATTERN);
    const timezoneMatch = text.match(TIMEZONE_PATTERN);
    const urls = text.match(URL_PATTERN)?.map(cleanUrl) ?? [];
    const meetingUrl = urls.find((url) => providerFor(url) !== null) ?? null;

    return {
      dateText,
      timeText: timeMatch?.[1]?.toUpperCase() ?? null,
      timezone: timezoneMatch?.[0]?.toUpperCase() ?? null,
      meetingUrl,
      meetingProvider: meetingUrl ? providerFor(meetingUrl) : null
    };
  }
}
