import { Page } from "playwright";

export type ApplicationHazardKind =
  | "captcha"
  | "assessment"
  | "work-authorization"
  | "sensitive-data";

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
    pattern: /(?:captcha|recaptcha|re-captcha|hcaptcha|i[’']m not a robot|verify you are human)/i,
    reason: "CAPTCHA or human-verification challenge detected; manual review is required."
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
  }
];

export class ApplicationHazardDetector {
  async detect(page: Page): Promise<readonly ApplicationHazard[]> {
    const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 30000);
    const iframeSources = await page.locator("iframe[src]").evaluateAll((iframes) =>
      iframes
        .map((iframe) => iframe.getAttribute("src") ?? "")
        .join(" ")
    ).catch(() => "");

    const combinedText = `${bodyText} ${iframeSources}`;
    const hazards: ApplicationHazard[] = [];

    for (const rule of HAZARD_RULES) {
      if (rule.pattern.test(combinedText)) {
        hazards.push({ kind: rule.kind, reason: rule.reason });
      }
    }

    return hazards;
  }
}
