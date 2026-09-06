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
  /thanks\s+for\s+applying/i,
  /application\s+complete/i,
  /application\s+confirmation/i
] as const;

const CONFIRMATION_URL_PATTERN = /(?:thank(?:s|-|_)?(?:you)?|success(?:ful|fully)?|confirmation|application[-_/]?(?:submitted|received|complete))/i;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export class SubmissionConfirmationDetector {
  async detect(page: Page): Promise<SubmissionConfirmationResult> {
    const url = page.url();
    const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));

    // Prefer confirmation text in semantically prominent/status elements. This
    // avoids treating arbitrary job-description text as proof of submission.
    const signalElements = page.locator(
      "h1, h2, [role='alert'], [role='status'], [aria-live='assertive'], [aria-live='polite']"
    );
    const signalTexts: string[] = [];
    for (let index = 0; index < await signalElements.count(); index += 1) {
      const text = normalizeText(await signalElements.nth(index).innerText().catch(() => ""));
      if (text) signalTexts.push(text);
    }

    const prominentText = signalTexts.join(" ");
    const matchingProminentPattern = CONFIRMATION_PATTERNS.find((pattern) =>
      pattern.test(prominentText)
    );

    if (matchingProminentPattern) {
      return {
        confirmed: true,
        confirmationUrl: url,
        signal: "Page text in a prominent/status element matched a known application confirmation pattern."
      };
    }

    // Some ATS pages replace the entire form with a short confirmation message
    // without using a heading or status role. A compact body containing only a
    // known confirmation phrase is safe to recognize; longer arbitrary body
    // text still requires multiple independent confirmation signals.
    const compactBodyConfirmation = CONFIRMATION_PATTERNS.some((pattern) =>
      pattern.test(bodyText) && bodyText.length <= 160
    );

    if (compactBodyConfirmation) {
      return {
        confirmed: true,
        confirmationUrl: url,
        signal: "Page text matched a known application confirmation pattern."
      };
    }

    // Some ATS pages expose the success message only in ordinary body text.
    // Require two independent confirmation phrases before trusting that case.
    const bodyMatches = CONFIRMATION_PATTERNS.filter((pattern) => pattern.test(bodyText));
    if (bodyMatches.length >= 2) {
      return {
        confirmed: true,
        confirmationUrl: url,
        signal: "Multiple page confirmation patterns matched after submission."
      };
    }

    try {
      const parsedUrl = new URL(url);
      if (CONFIRMATION_URL_PATTERN.test(parsedUrl.pathname)) {
        return {
          confirmed: true,
          confirmationUrl: url,
          signal: "Confirmation URL path matched a known success pattern."
        };
      }
    } catch {
      // Ignore malformed URLs; the browser normally exposes an absolute URL.
    }

    return {
      confirmed: false,
      confirmationUrl: null,
      signal: null
    };
  }
}
