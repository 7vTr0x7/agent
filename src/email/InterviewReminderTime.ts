import { InterviewDetails } from "./InterviewDetailsExtractor";

const TIMEZONE_OFFSETS_MINUTES: Readonly<Record<string, number>> = {
  UTC: 0,
  GMT: 0,
  IST: 330,
  BST: 60,
  CET: 60,
  CEST: 120,
  EET: 120,
  EEST: 180,
  PST: -480,
  PDT: -420,
  MST: -420,
  MDT: -360,
  CST: -360,
  CDT: -300,
  EST: -300,
  EDT: -240
};

export function parseInterviewStart(details: InterviewDetails): Date | null {
  if (!details.dateText || !details.timeText || !details.timezone) return null;

  const offsetMinutes = TIMEZONE_OFFSETS_MINUTES[details.timezone.toUpperCase()];
  if (offsetMinutes === undefined) return null;

  const date = new Date(details.dateText);
  if (Number.isNaN(date.getTime())) return null;

  const timeMatch = details.timeText.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const meridiem = timeMatch[3].toUpperCase();
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
  return new Date(utc - offsetMinutes * 60_000);
}

export function calculateInterviewReminderAt(details: InterviewDetails, hoursBefore = 24): Date | null {
  if (hoursBefore <= 0) return null;
  const start = parseInterviewStart(details);
  if (!start) return null;
  return new Date(start.getTime() - hoursBefore * 60 * 60 * 1000);
}
