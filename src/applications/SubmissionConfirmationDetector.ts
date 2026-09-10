import { Page } from "playwright";

export interface SubmissionConfirmationResult {
  confirmed: boolean;
  confirmationUrl: string | null;
  signal: string | null;
}

const CONFIRMATION_PATTERNS = [
  /application\s+(?:(?:has\s+been|was|is)\s+)?(?:submitted|received|sent)/i,
  /successfully\s+applied/i,
  /successfully\s+submitted/i,
  /thank\s+you\s+for\s+applying/i,
  /thanks\s+for\s+applying/i,
  /application\s+complete/i,
  /application\s+confirmation/i
] as const;

const STANDALONE_CONFIRMATION_PATTERNS = [
  /^application\s+(?:(?:has\s+been|was|is)\s+)?(?:submitted|received|sent)(?:\s+successfully)?[.!]?$/i,
  /^successfully\s+(?:applied|submitted)[.!]?$/i,
  /^thank\s+you\s+for\s+applying[.!]?$/i,
  /^thanks\s+for\s+applying[.!]?$/i,
  /^application\s+complete[.!]?$/i,
  /^application\s+confirmation[.!]?$/i
] as const;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export class SubmissionConfirmationDetector {
  async detect(page: Page): Promise<SubmissionConfirmationResult> {
    const url = page.url();
    const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));

    // Confirmation must come from actual page evidence. A success-looking URL
    // by itself is not enough because redirects and ordinary job URLs can be
    // misleading. Prefer prominent/status elements first.
    const signalElements = page.locator(
      "h1, h2, [role='alert'], [role='status'], [aria-live='assertive'], [aria-live='polite']"
    );
    const signalTexts: string[] = [];
    for (let index = 0; index < await signalElements.count(); index += 1) {
      const text = normalizeText(await signalElements.nth(index).innerText().catch(() => ""));
      if (text) signalTexts.push(text);
    }

    const prominentText = signalTexts.join(" ");
    const matchingProminentPattern = CONFIRMATION_PATTERNS.find((pattern) => pattern.test(prominentText));
    if (matchingProminentPattern) {
      return {
        confirmed: true,
        confirmationUrl: url,
        signal: "Page text in a prominent/status element matched a known application confirmation pattern."
      };
    }

    // Some ATS pages replace the form with a short confirmation message
    // without using a heading or status role. Only an entire compact body that
    // is itself a known confirmation phrase is accepted here.
    if (STANDALONE_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(bodyText))) {
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

    return { confirmed: false, confirmationUrl: null, signal: null };
  }
}
