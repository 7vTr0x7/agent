import { Page } from "playwright";

export type ApplicationHazardKind =
  | "captcha"
  | "assessment"
  | "work-authorization"
  | "sensitive-data"
  | "authentication"
  | "bot-challenge"
  | "prompt-injection";

export interface ApplicationHazard {
  kind: ApplicationHazardKind;
  reason: string;
}

const HAZARD_RULES: readonly {
  kind: ApplicationHazardKind;
  pattern: RegExp;
  reason: string;
}[] = [
  {
    kind: "captcha",
    pattern: /(?:captcha|recaptcha|re-captcha|hcaptcha|i[’']m not a robot|verify you are human|human verification)/i,
    reason: "CAPTCHA or human-verification challenge detected; manual review is required."
  },
  {
    kind: "bot-challenge",
    pattern: /(?:cloudflare|checking your browser|checking if the site connection is secure|attention required|bot detection|automated access|security challenge|challenge-platform)/i,
    reason: "Bot or security challenge detected; automation must stop without attempting to bypass it."
  },
  {
    kind: "authentication",
    pattern: /(?:two-factor authentication|two factor authentication|2fa|one-time password|one time password|otp|verification code|device verification|sign in to continue|log in to continue|create an account to apply)/i,
    reason: "Authentication or device-verification challenge detected; credentials and MFA must never be automated."
  },
  {
    kind: "assessment",
    pattern: /(?:coding challenge|technical assessment|skills assessment|online assessment|personality test|cognitive test|pre-employment test|take-home assignment)/i,
    reason: "Assessment or candidate test detected; it must not be completed automatically."
  },
  {
    kind: "work-authorization",
    pattern: /(?:work authorization|legally authorized to work|right to work|work permit|visa sponsorship|require sponsorship|need sponsorship)/i,
    reason: "Work-authorization or sponsorship question detected; the answer must not be guessed."
  },
  {
    kind: "sensitive-data",
    pattern: /(?:social security number|social security no\.?|aadhaar(?: number)?|passport number|bank account(?: number)?|credit card(?: number)?|debit card(?: number)?)/i,
    reason: "Sensitive identity or financial information was requested; automatic submission is blocked."
  },
  {
    kind: "prompt-injection",
    pattern: /(?:ignore (?:all|any|the) previous instructions|ignore previous instructions|disregard previous instructions|system prompt|developer message|execute (?:this|the) command|run (?:this|the) command|reveal (?:your|the) credentials|print (?:the )?(?:secret|token|password)|disable (?:the )?(?:safety|security) (?:gate|check))/i,
    reason: "Untrusted application content contains instruction-like prompt injection; it cannot control agent behavior."
  }
];

export class ApplicationHazardDetector {
  async detect(page: Page): Promise<readonly ApplicationHazard[]> {
    const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 30000);
    const iframeSources = await page.locator("iframe[src]").evaluateAll((iframes) =>
      iframes.map((iframe) => iframe.getAttribute("src") ?? "").join(" ")
    ).catch(() => "");

    const passwordCount = await page.locator('input[type="password"]').count().catch(() => 0);
    const combinedText = `${bodyText} ${iframeSources} ${passwordCount > 0 ? "password authentication field" : ""}`;
    const hazards: ApplicationHazard[] = [];

    for (const rule of HAZARD_RULES) {
      if (rule.pattern.test(combinedText)) hazards.push({ kind: rule.kind, reason: rule.reason });
    }

    return hazards;
  }
}
