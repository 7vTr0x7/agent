import "dotenv/config";

export interface AppConfig {
  nodeEnv: string; logLevel: string; automationEnabled: boolean; applicationDryRun: boolean; outboundEnabled: boolean; discoveryEnabled: boolean; discoveryIntervalMs: number; applicationQueueIntervalMs: number; staleSubmissionCheckIntervalMs: number; staleSubmissionThresholdMinutes: number; followUpIntervalMs: number; interviewReminderIntervalMs: number; jobSources: string; genericApplicationAdapterEnabled: boolean; applicationRateLimitPerDay: number; applicationCompanyRateLimitPerDay: number;
  recruiterOutreach: { enabled: boolean; dryRun: boolean; activation: "disabled" | "canary" | "live"; liveActivationConfirmed: boolean; discoveryProvider: "hunter" | "snov" | "job-posting"; minConfidence: number; requireVerifiedEmail: boolean; maxContactsPerApplication: number; maxMessagesPerDay: number; maxMessagesPerHour: number; followUpEnabled: boolean; followUpDayOffsets: number[]; genericEmailFallback: boolean; hunterApiKey: string | null; snovClientId: string | null; snovClientSecret: string | null; };
  resume: { tailoringEnabled: boolean; masterPath: string | null; outputDirectory: string; };
  ollama: { baseUrl: string; model: string; timeoutMs: number; };
  databaseUrl: string;
  email: { enabled: boolean; provider: "resend"; apiKey: string | null; from: string | null; };
  gmail: { enabled: boolean; accountTier: "consumer" | "workspace"; dailySendLimit: number; clientId: string | null; clientSecret: string | null; refreshToken: string | null; userEmail: string | null; syncQuery: string; syncIntervalMs: number; };
}

const DEFAULT_JOB_SOURCES = JSON.stringify([
  { id: "remoteok:json", type: "api", name: "remoteok", feedUrl: "https://remoteok.com/api", status: "APPROVED" },
  { id: "himalayas:json", type: "api", name: "himalayas", feedUrl: "https://himalayas.app/jobs/api?limit=20", status: "APPROVED" },
  { id: "jobicy:json", type: "api", name: "jobicy", feedUrl: "https://jobicy.com/api/v2/remote-jobs?count=200", status: "APPROVED" },
  { id: "arbeitnow:json", type: "api", name: "arbeitnow", feedUrl: "https://www.arbeitnow.com/api/job-board-api", status: "APPROVED" },
  { id: "weworkremotely:rss", type: "rss", name: "weworkremotely", feedUrl: "https://weworkremotely.com/remote-jobs.rss", status: "APPROVED" },
  { id: "remotefirstjobs:react:rss", type: "rss", name: "remotefirstjobs-react", feedUrl: "https://remotefirstjobs.com/rss/react", status: "APPROVED" },
  { id: "remotefirstjobs:software:rss", type: "rss", name: "remotefirstjobs-software", feedUrl: "https://remotefirstjobs.com/rss/software-development", status: "APPROVED" },
  { id: "remoteyeah:engineering:rss", type: "rss", name: "remoteyeah-engineering", feedUrl: "https://remoteyeah.com/rss.xml", status: "APPROVED" },
  { id: "workanywhere:frontend:rss", type: "rss", name: "workanywhere-frontend", feedUrl: "https://www.workanywhere.pro/rss/frontend", status: "APPROVED" },
  { id: "workanywhere:fullstack:rss", type: "rss", name: "workanywhere-fullstack", feedUrl: "https://www.workanywhere.pro/rss/fullstack", status: "APPROVED" },
  { id: "hireweb3:rss", type: "rss", name: "hireweb3", feedUrl: "https://hireweb3.io/job/rss", status: "APPROVED" }
]);

function required(name: string, value: string | undefined): string { if (!value) throw new Error(`Missing required environment variable: ${name}`); return value; }
function positiveInteger(name: string, value: string | undefined): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`); return parsed; }
function nonNegativeInteger(name: string, value: string): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`); return parsed; }
function boundedInteger(name: string, value: string | undefined, min: number, max: number): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`); return parsed; }
function booleanValue(name: string, value: string | undefined, fallback: boolean): boolean { if (value === undefined) return fallback; if (value === "true") return true; if (value === "false") return false; throw new Error(`${name} must be true or false`); }
function dayOffsets(name: string, value: string): number[] { const offsets = value.split(",").map((item) => nonNegativeInteger(name, item.trim())); if (offsets.length === 0) throw new Error(`${name} must contain strictly increasing non-negative integers`); for (let index = 1; index < offsets.length; index += 1) { const previous = offsets[index - 1]; const current = offsets[index]; if (previous === undefined || current === undefined || current <= previous) throw new Error(`${name} must contain strictly increasing non-negative integers`); } return offsets; }

export function loadConfig(): AppConfig {
  const emailEnabled = booleanValue("EMAIL_ENABLED", process.env.EMAIL_ENABLED, false);
  const resumeTailoringEnabled = booleanValue("RESUME_TAILORING_ENABLED", process.env.RESUME_TAILORING_ENABLED, false);
  const gmailEnabled = booleanValue("GMAIL_ENABLED", process.env.GMAIL_ENABLED, false);
  const gmailAccountTier = process.env.GMAIL_ACCOUNT_TIER ?? "consumer";
  if (gmailAccountTier !== "consumer" && gmailAccountTier !== "workspace") throw new Error("GMAIL_ACCOUNT_TIER must be consumer or workspace");
  const gmailDailySendLimit = gmailAccountTier === "workspace" ? 2000 : 500;
  const recruiterOutreachEnabled = booleanValue("RECRUITER_OUTREACH_ENABLED", process.env.RECRUITER_OUTREACH_ENABLED, false);
  const recruiterDryRun = booleanValue("RECRUITER_OUTREACH_DRY_RUN", process.env.RECRUITER_OUTREACH_DRY_RUN, true);
  const recruiterActivation = process.env.RECRUITER_OUTREACH_ACTIVATION ?? "disabled";
  if (recruiterActivation !== "disabled" && recruiterActivation !== "canary" && recruiterActivation !== "live") throw new Error("RECRUITER_OUTREACH_ACTIVATION must be disabled, canary, or live");
  const recruiterLiveActivationConfirmed = booleanValue("RECRUITER_LIVE_ACTIVATION_CONFIRMED", process.env.RECRUITER_LIVE_ACTIVATION_CONFIRMED, false);
  const recruiterProvider = process.env.RECRUITER_DISCOVERY_PROVIDER ?? "job-posting";
  if (recruiterProvider !== "hunter" && recruiterProvider !== "snov" && recruiterProvider !== "job-posting") throw new Error("RECRUITER_DISCOVERY_PROVIDER must be hunter, snov, or job-posting");
  const hunterApiKey = process.env.HUNTER_API_KEY?.trim() || null;
  const snovClientId = process.env.SNOV_CLIENT_ID?.trim() || null;
  const snovClientSecret = process.env.SNOV_CLIENT_SECRET?.trim() || null;
  if (recruiterOutreachEnabled && recruiterProvider === "hunter" && !hunterApiKey) throw new Error("Missing required environment variable: HUNTER_API_KEY");
  if (recruiterOutreachEnabled && recruiterProvider === "snov" && (!snovClientId || !snovClientSecret)) throw new Error("Missing required environment variables: SNOV_CLIENT_ID and SNOV_CLIENT_SECRET");
  const recruiterDefaultDailyLimit = gmailDailySendLimit;
  const recruiterDefaultHourlyLimit = Math.ceil(gmailDailySendLimit / 24);
  const recruiterMaxMessagesPerDay = positiveInteger("RECRUITER_MAX_MESSAGES_PER_DAY", process.env.RECRUITER_MAX_MESSAGES_PER_DAY ?? String(recruiterDefaultDailyLimit));
  const recruiterMaxMessagesPerHour = positiveInteger("RECRUITER_MAX_MESSAGES_PER_HOUR", process.env.RECRUITER_MAX_MESSAGES_PER_HOUR ?? String(recruiterDefaultHourlyLimit));
  const configuredJobSources = process.env.JOB_SOURCES?.trim();
  return {
    nodeEnv: process.env.NODE_ENV ?? "development", logLevel: process.env.LOG_LEVEL ?? "info", automationEnabled: booleanValue("AUTOMATION_ENABLED", process.env.AUTOMATION_ENABLED, false), applicationDryRun: booleanValue("APPLICATION_DRY_RUN", process.env.APPLICATION_DRY_RUN, true), outboundEnabled: booleanValue("OUTBOUND_ENABLED", process.env.OUTBOUND_ENABLED, false), discoveryEnabled: booleanValue("JOB_DISCOVERY_ENABLED", process.env.JOB_DISCOVERY_ENABLED, true), discoveryIntervalMs: positiveInteger("JOB_DISCOVERY_INTERVAL_MS", process.env.JOB_DISCOVERY_INTERVAL_MS ?? "900000"), applicationQueueIntervalMs: positiveInteger("APPLICATION_QUEUE_INTERVAL_MS", process.env.APPLICATION_QUEUE_INTERVAL_MS ?? "30000"), staleSubmissionCheckIntervalMs: positiveInteger("STALE_SUBMISSION_CHECK_INTERVAL_MS", process.env.STALE_SUBMISSION_CHECK_INTERVAL_MS ?? "300000"), staleSubmissionThresholdMinutes: positiveInteger("STALE_SUBMISSION_THRESHOLD_MINUTES", process.env.STALE_SUBMISSION_THRESHOLD_MINUTES ?? "30"), followUpIntervalMs: positiveInteger("FOLLOW_UP_INTERVAL_MS", process.env.FOLLOW_UP_INTERVAL_MS ?? "300000"), interviewReminderIntervalMs: positiveInteger("INTERVIEW_REMINDER_INTERVAL_MS", process.env.INTERVIEW_REMINDER_INTERVAL_MS ?? "300000"), jobSources: configuredJobSources || DEFAULT_JOB_SOURCES, genericApplicationAdapterEnabled: booleanValue("GENERIC_APPLICATION_ADAPTER_ENABLED", process.env.GENERIC_APPLICATION_ADAPTER_ENABLED, false), applicationRateLimitPerDay: positiveInteger("APPLICATION_RATE_LIMIT_PER_DAY", process.env.APPLICATION_RATE_LIMIT_PER_DAY ?? "50"), applicationCompanyRateLimitPerDay: positiveInteger("APPLICATION_COMPANY_RATE_LIMIT_PER_DAY", process.env.APPLICATION_COMPANY_RATE_LIMIT_PER_DAY ?? "5"),
    recruiterOutreach: { enabled: recruiterOutreachEnabled, dryRun: recruiterDryRun, activation: recruiterActivation, liveActivationConfirmed: recruiterLiveActivationConfirmed, discoveryProvider: recruiterProvider, minConfidence: boundedInteger("RECRUITER_MIN_CONFIDENCE", process.env.RECRUITER_MIN_CONFIDENCE ?? "80", 0, 100), requireVerifiedEmail: booleanValue("RECRUITER_REQUIRE_VERIFIED_EMAIL", process.env.RECRUITER_REQUIRE_VERIFIED_EMAIL, true), maxContactsPerApplication: positiveInteger("RECRUITER_MAX_CONTACTS_PER_APPLICATION", process.env.RECRUITER_MAX_CONTACTS_PER_APPLICATION ?? "3"), maxMessagesPerDay: recruiterMaxMessagesPerDay, maxMessagesPerHour: recruiterMaxMessagesPerHour, followUpEnabled: booleanValue("RECRUITER_FOLLOWUP_ENABLED", process.env.RECRUITER_FOLLOWUP_ENABLED, false), followUpDayOffsets: dayOffsets("RECRUITER_FOLLOWUP_DAY_OFFSETS", process.env.RECRUITER_FOLLOWUP_DAY_OFFSETS ?? "4,10,18"), genericEmailFallback: booleanValue("RECRUITER_GENERIC_EMAIL_FALLBACK", process.env.RECRUITER_GENERIC_EMAIL_FALLBACK, true), hunterApiKey, snovClientId, snovClientSecret },
    resume: { tailoringEnabled: resumeTailoringEnabled, masterPath: resumeTailoringEnabled ? required("RESUME_MASTER_PATH", process.env.RESUME_MASTER_PATH) : null, outputDirectory: process.env.RESUME_OUTPUT_DIRECTORY ?? "./data/resumes" },
    ollama: { baseUrl: (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/+$/, ""), model: process.env.OLLAMA_MODEL ?? "qwen3:8b", timeoutMs: positiveInteger("OLLAMA_TIMEOUT_MS", process.env.OLLAMA_TIMEOUT_MS ?? "120000") },
    databaseUrl: required("DATABASE_URL", process.env.DATABASE_URL),
    email: { enabled: emailEnabled, provider: "resend", apiKey: emailEnabled ? required("RESEND_API_KEY", process.env.RESEND_API_KEY) : null, from: emailEnabled ? required("EMAIL_FROM", process.env.EMAIL_FROM) : null },
    gmail: { enabled: gmailEnabled, accountTier: gmailAccountTier, dailySendLimit: gmailDailySendLimit, clientId: gmailEnabled ? required("GMAIL_CLIENT_ID", process.env.GMAIL_CLIENT_ID) : null, clientSecret: gmailEnabled ? required("GMAIL_CLIENT_SECRET", process.env.GMAIL_CLIENT_SECRET) : null, refreshToken: gmailEnabled ? required("GMAIL_REFRESH_TOKEN", process.env.GMAIL_REFRESH_TOKEN) : null, userEmail: gmailEnabled ? required("GMAIL_USER_EMAIL", process.env.GMAIL_USER_EMAIL) : null, syncQuery: process.env.GMAIL_SYNC_QUERY ?? "newer_than:14d -from:me", syncIntervalMs: positiveInteger("GMAIL_SYNC_INTERVAL_MS", process.env.GMAIL_SYNC_INTERVAL_MS ?? "120000") }
  };
}
