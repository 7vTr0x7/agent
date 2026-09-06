import "dotenv/config";

export interface AppConfig {
  nodeEnv: string;
  logLevel: string;
  automationEnabled: boolean;
  applicationDryRun: boolean;
  discoveryEnabled: boolean;
  discoveryIntervalMs: number;
  applicationQueueIntervalMs: number;
  staleSubmissionCheckIntervalMs: number;
  staleSubmissionThresholdMinutes: number;
  followUpIntervalMs: number;
  interviewReminderIntervalMs: number;
  jobSources: string;
  genericApplicationAdapterEnabled: boolean;
  applicationRateLimitPerDay: number;
  applicationCompanyRateLimitPerDay: number;
  recruiterOutreach: {
    enabled: boolean;
    dryRun: boolean;
    discoveryProvider: "hunter";
    minConfidence: number;
    requireVerifiedEmail: boolean;
    maxContactsPerApplication: number;
    maxMessagesPerDay: number;
    maxMessagesPerHour: number;
    followUpEnabled: boolean;
    followUpDayOffsets: number[];
    genericEmailFallback: boolean;
    hunterApiKey: string | null;
  };
  resume: {
    tailoringEnabled: boolean;
    masterPath: string | null;
    outputDirectory: string;
  };
  ollama: {
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
  databaseUrl: string;
  email: {
    enabled: boolean;
    provider: "resend";
    apiKey: string | null;
    from: string | null;
  };
  gmail: {
    enabled: boolean;
    clientId: string | null;
    clientSecret: string | null;
    refreshToken: string | null;
    userEmail: string | null;
    syncQuery: string;
    syncIntervalMs: number;
  };
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(name: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function boundedInteger(name: string, value: string | undefined, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function booleanValue(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function dayOffsets(name: string, value: string): number[] {
  const offsets = value.split(",").map((item) => nonNegativeInteger(name, item.trim()));
  if (offsets.length === 0) {
    throw new Error(`${name} must contain strictly increasing non-negative integers`);
  }

  for (let index = 1; index < offsets.length; index += 1) {
    const previous = offsets[index - 1];
    const current = offsets[index];
    if (previous === undefined || current === undefined || current <= previous) {
      throw new Error(`${name} must contain strictly increasing non-negative integers`);
    }
  }

  return offsets;
}

export function loadConfig(): AppConfig {
  const emailEnabled = booleanValue("EMAIL_ENABLED", process.env.EMAIL_ENABLED, false);
  const resumeTailoringEnabled = booleanValue("RESUME_TAILORING_ENABLED", process.env.RESUME_TAILORING_ENABLED, false);
  const gmailEnabled = booleanValue("GMAIL_ENABLED", process.env.GMAIL_ENABLED, false);
  const recruiterOutreachEnabled = booleanValue("RECRUITER_OUTREACH_ENABLED", process.env.RECRUITER_OUTREACH_ENABLED, false);
  const recruiterDryRun = booleanValue("RECRUITER_OUTREACH_DRY_RUN", process.env.RECRUITER_OUTREACH_DRY_RUN, true);
  const recruiterProvider = process.env.RECRUITER_DISCOVERY_PROVIDER ?? "hunter";
  if (recruiterProvider !== "hunter") {
    throw new Error("RECRUITER_DISCOVERY_PROVIDER must be hunter until another provider is explicitly implemented");
  }

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    logLevel: process.env.LOG_LEVEL ?? "info",
    automationEnabled: booleanValue("AUTOMATION_ENABLED", process.env.AUTOMATION_ENABLED, false),
    applicationDryRun: booleanValue("APPLICATION_DRY_RUN", process.env.APPLICATION_DRY_RUN, true),
    discoveryEnabled: booleanValue("JOB_DISCOVERY_ENABLED", process.env.JOB_DISCOVERY_ENABLED, true),
    discoveryIntervalMs: positiveInteger("JOB_DISCOVERY_INTERVAL_MS", process.env.JOB_DISCOVERY_INTERVAL_MS ?? "900000"),
    applicationQueueIntervalMs: positiveInteger("APPLICATION_QUEUE_INTERVAL_MS", process.env.APPLICATION_QUEUE_INTERVAL_MS ?? "30000"),
    staleSubmissionCheckIntervalMs: positiveInteger("STALE_SUBMISSION_CHECK_INTERVAL_MS", process.env.STALE_SUBMISSION_CHECK_INTERVAL_MS ?? "300000"),
    staleSubmissionThresholdMinutes: positiveInteger("STALE_SUBMISSION_THRESHOLD_MINUTES", process.env.STALE_SUBMISSION_THRESHOLD_MINUTES ?? "30"),
    followUpIntervalMs: positiveInteger("FOLLOW_UP_INTERVAL_MS", process.env.FOLLOW_UP_INTERVAL_MS ?? "300000"),
    interviewReminderIntervalMs: positiveInteger("INTERVIEW_REMINDER_INTERVAL_MS", process.env.INTERVIEW_REMINDER_INTERVAL_MS ?? "300000"),
    jobSources: process.env.JOB_SOURCES ?? "",
    genericApplicationAdapterEnabled: booleanValue("GENERIC_APPLICATION_ADAPTER_ENABLED", process.env.GENERIC_APPLICATION_ADAPTER_ENABLED, false),
    applicationRateLimitPerDay: positiveInteger("APPLICATION_RATE_LIMIT_PER_DAY", process.env.APPLICATION_RATE_LIMIT_PER_DAY ?? "50"),
    applicationCompanyRateLimitPerDay: positiveInteger("APPLICATION_COMPANY_RATE_LIMIT_PER_DAY", process.env.APPLICATION_COMPANY_RATE_LIMIT_PER_DAY ?? "5"),
    recruiterOutreach: {
      enabled: recruiterOutreachEnabled,
      dryRun: recruiterDryRun,
      discoveryProvider: "hunter",
      minConfidence: boundedInteger("RECRUITER_MIN_CONFIDENCE", process.env.RECRUITER_MIN_CONFIDENCE ?? "80", 0, 100),
      requireVerifiedEmail: booleanValue("RECRUITER_REQUIRE_VERIFIED_EMAIL", process.env.RECRUITER_REQUIRE_VERIFIED_EMAIL, true),
      maxContactsPerApplication: positiveInteger("RECRUITER_MAX_CONTACTS_PER_APPLICATION", process.env.RECRUITER_MAX_CONTACTS_PER_APPLICATION ?? "3"),
      maxMessagesPerDay: positiveInteger("RECRUITER_MAX_MESSAGES_PER_DAY", process.env.RECRUITER_MAX_MESSAGES_PER_DAY ?? "499"),
      maxMessagesPerHour: positiveInteger("RECRUITER_MAX_MESSAGES_PER_HOUR", process.env.RECRUITER_MAX_MESSAGES_PER_HOUR ?? "15"),
      followUpEnabled: booleanValue("RECRUITER_FOLLOWUP_ENABLED", process.env.RECRUITER_FOLLOWUP_ENABLED, false),
      followUpDayOffsets: dayOffsets("RECRUITER_FOLLOWUP_DAY_OFFSETS", process.env.RECRUITER_FOLLOWUP_DAY_OFFSETS ?? "4,10,18"),
      genericEmailFallback: booleanValue("RECRUITER_GENERIC_EMAIL_FALLBACK", process.env.RECRUITER_GENERIC_EMAIL_FALLBACK, true),
      hunterApiKey: recruiterOutreachEnabled ? required("HUNTER_API_KEY", process.env.HUNTER_API_KEY) : null
    },
    resume: {
      tailoringEnabled: resumeTailoringEnabled,
      masterPath: resumeTailoringEnabled ? required("RESUME_MASTER_PATH", process.env.RESUME_MASTER_PATH) : null,
      outputDirectory: process.env.RESUME_OUTPUT_DIRECTORY ?? "./data/resumes"
    },
    ollama: {
      baseUrl: (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/+$/, ""),
      model: process.env.OLLAMA_MODEL ?? "qwen3:8b",
      timeoutMs: positiveInteger("OLLAMA_TIMEOUT_MS", process.env.OLLAMA_TIMEOUT_MS ?? "120000")
    },
    databaseUrl: required("DATABASE_URL", process.env.DATABASE_URL),
    email: {
      enabled: emailEnabled,
      provider: "resend",
      apiKey: emailEnabled ? required("RESEND_API_KEY", process.env.RESEND_API_KEY) : null,
      from: emailEnabled ? required("EMAIL_FROM", process.env.EMAIL_FROM) : null
    },
    gmail: {
      enabled: gmailEnabled,
      clientId: gmailEnabled ? required("GMAIL_CLIENT_ID", process.env.GMAIL_CLIENT_ID) : null,
      clientSecret: gmailEnabled ? required("GMAIL_CLIENT_SECRET", process.env.GMAIL_CLIENT_SECRET) : null,
      refreshToken: gmailEnabled ? required("GMAIL_REFRESH_TOKEN", process.env.GMAIL_REFRESH_TOKEN) : null,
      userEmail: gmailEnabled ? required("GMAIL_USER_EMAIL", process.env.GMAIL_USER_EMAIL) : null,
      syncQuery: process.env.GMAIL_SYNC_QUERY ?? "newer_than:14d -from:me",
      syncIntervalMs: positiveInteger("GMAIL_SYNC_INTERVAL_MS", process.env.GMAIL_SYNC_INTERVAL_MS ?? "120000")
    }
  };
}
