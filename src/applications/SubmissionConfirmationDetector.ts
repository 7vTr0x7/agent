import { Page } from "playwright";

export interface SubmissionConfirmationResult {
  confirmed: boolean;
  confirmationUrl: string | null;
  signal: string | null;
}

const CONFIRMATION_PATTERNS = [
  /application\s+(?:has\s+been\s+)?submitted/i,
  /application\s+(?:has\s+been\s+)?received/i,
  /successfully\s+applied/i,
  /successfully\s+submitted/i,
  /thank\s+you\s+for\s+applying/i,
  /application\s+complete/i,
  /application\s+confirmation/i
] as const;

const CONFIRMATION_URL_PATTERN = /(?:thank|success|confirmation|application[-_/]?(?:submitted|received|complete))/i;

export class SubmissionConfirmationDetector {
  async detect(page: Page): Promise<SubmissionConfirmationResult> {
    const url = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const normalizedText = bodyText.replace(/\s+/g, " ").trim();
    const matchingPattern = CONFIRMATION_PATTERNS.find((pattern) =>
      pattern.test(normalizedText)
    );

    if (matchingPattern) {
      return {
        confirmed: true,
        confirmationUrl: url,
        signal: "Page text matched a known application confirmation pattern."
      };
    }

    if (CONFIRMATION_URL_PATTERN.test(url)) {
      return {
        confirmed: true,
        confirmationUrl: url,
        signal: "Confirmation URL matched a known success pattern."
      };
    }

    return {
      confirmed: false,
      confirmationUrl: null,
      signal: null
    };
  }
}
