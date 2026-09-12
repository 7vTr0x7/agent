export type ApplicationFailureCode =
  | "UNSUPPORTED_PLATFORM"
  | "INVALID_APPLICATION_URL"
  | "AUTH_REQUIRED"
  | "CAPTCHA_REQUIRED"
  | "BOT_CHALLENGE"
  | "MISSING_REQUIRED_DATA"
  | "UNSUPPORTED_FIELD"
  | "INVALID_ATTACHMENT"
  | "DUPLICATE_APPLICATION"
  | "EXCLUDED_EMPLOYER"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PROVIDER_ERROR"
  | "SUBMISSION_AMBIGUOUS"
  | "VALIDATION_FAILED"
  | "MANUAL_REVIEW"
  | "PROMPT_INJECTION";

export function classifyApplicationFailure(reason: string, outcome?: string): ApplicationFailureCode | null {
  const text = reason.toLowerCase();
  if (/(?:ignore previous instructions|prompt injection|system prompt|developer message|execute (?:this|the) command)/i.test(text)) return "PROMPT_INJECTION";
  if (/(?:captcha|recaptcha|hcaptcha|human-verification|verify you are human)/i.test(text)) return "CAPTCHA_REQUIRED";
  if (/(?:cloudflare|bot challenge|bot detection|security challenge|checking your browser)/i.test(text)) return "BOT_CHALLENGE";
  if (/(?:authentication|sign in|log in|mfa|two-factor|one-time password|otp|device verification)/i.test(text)) return "AUTH_REQUIRED";
  if (/(?:unsupported platform|adapter .*catalog|adapter .*unsupported|does not .*application automation)/i.test(text)) return "UNSUPPORTED_PLATFORM";
  if (/(?:invalid application (?:url|target)|malicious redirect|different host)/i.test(text)) return "INVALID_APPLICATION_URL";
  if (/(?:duplicate|already applied|already exists)/i.test(text)) return "DUPLICATE_APPLICATION";
  if (/(?:excluded employer|permanently excluded)/i.test(text)) return "EXCLUDED_EMPLOYER";
  if (/(?:resume path|attachment|file input|invalid attachment)/i.test(text)) return "INVALID_ATTACHMENT";
  if (/(?:required .*field|missing .*data|no candidate value)/i.test(text)) return "MISSING_REQUIRED_DATA";
  if (/(?:unsupported field|unsupported question|custom question)/i.test(text)) return "UNSUPPORTED_FIELD";
  if (/(?:timed out|timeout)/i.test(text)) return "TIMEOUT";
  if (/(?:network|connection|dns)/i.test(text)) return "NETWORK_ERROR";
  if (/(?:provider|ats .*error|submission provider)/i.test(text)) return "PROVIDER_ERROR";
  if (outcome === "AMBIGUOUS" || /ambiguous|reconciliation/i.test(text)) return "SUBMISSION_AMBIGUOUS";
  if (/(?:validation failed|manual review|required .*manual)/i.test(text)) return "VALIDATION_FAILED";
  if (outcome === "NOT_SUBMITTED" || outcome === "DEFINITIVE_FAILURE") return "MANUAL_REVIEW";
  return null;
}
