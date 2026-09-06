import { Locator, Page } from "playwright";
import {
  ApplicationAdapter,
  ApplicationContext,
  ApplicationSubmissionResult
} from "./ApplicationAdapter";
import { SubmissionConfirmationDetector } from "./SubmissionConfirmationDetector";

const TALEO_HOST_PATTERNS = [
  /^taleo\.net$/i,
  /^.*\.taleo\.net$/i,
  /^taleo\.com$/i,
  /^.*\.taleo\.com$/i
] as const;

const TALEO_SUBMIT_LABEL = /^(?:submit(?: application)?|complete application)$/i;

export class TaleoSubmitControlResolver {
  async resolve(page: Page): Promise<Locator | null> {
    const controls = page.locator(
      "button, input[type='submit'], input[type='button']"
    );
    const matches: Locator[] = [];

    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index);
      if (!(await control.isVisible()) || !(await control.isEnabled())) {
        continue;
      }

      const id = (await control.getAttribute("id"))?.trim().toLowerCase() ?? "";
      const name = (await control.getAttribute("name"))?.trim().toLowerCase() ?? "";
      const dataTestId =
        (await control.getAttribute("data-testid"))?.trim().toLowerCase() ?? "";
      const ariaLabel = (await control.getAttribute("aria-label"))?.trim() ?? "";
      const text = (await control.innerText().catch(() => "")).trim();
      const value = (await control.getAttribute("value"))?.trim() ?? "";
      const label = ariaLabel || text || value;

      const isKnownSubmitControl =
        id === "submit" ||
        id === "submitapplication" ||
        name === "submit" ||
        dataTestId === "submit";
      const isSubmitLabel = TALEO_SUBMIT_LABEL.test(label);

      if (isKnownSubmitControl || isSubmitLabel) {
        matches.push(control);
      }
    }

    return matches.length === 1 ? matches[0] ?? null : null;
  }
}

export class TaleoApplicationAdapter implements ApplicationAdapter {
  readonly name = "taleo";

  constructor(
    private readonly submitResolver = new TaleoSubmitControlResolver(),
    private readonly confirmationDetector = new SubmissionConfirmationDetector()
  ) {}

  canHandle(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return TALEO_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
    } catch {
      return false;
    }
  }

  async submit(
    page: Page,
    _context: ApplicationContext
  ): Promise<ApplicationSubmissionResult> {
    await page.waitForLoadState("domcontentloaded");

    const submitControl = await this.submitResolver.resolve(page);
    if (!submitControl) {
      return {
        submitted: false,
        externalApplicationId: null,
        confirmationUrl: null,
        reason:
          "Taleo submit control could not be uniquely verified; manual review required."
      };
    }

    try {
      await submitControl.click();
    } catch (error) {
      return {
        submitted: false,
        externalApplicationId: null,
        confirmationUrl: null,
        reason: `Taleo submit control could not be clicked: ${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }

    await page.waitForLoadState("domcontentloaded").catch(() => undefined);

    const confirmation = await this.confirmationDetector.detect(page);
    if (!confirmation.confirmed) {
      return {
        submitted: false,
        externalApplicationId: null,
        confirmationUrl: null,
        reason:
          "Taleo submit control was clicked, but application confirmation could not be verified."
      };
    }

    return {
      submitted: true,
      externalApplicationId: null,
      confirmationUrl: confirmation.confirmationUrl,
      reason: confirmation.signal ?? "Taleo application submission was confirmed."
    };
  }
}
