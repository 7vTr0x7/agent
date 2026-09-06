import { Locator, Page } from "playwright";
import {
  ApplicationAdapter,
  ApplicationContext,
  ApplicationSubmissionResult
} from "./ApplicationAdapter";
import { SubmissionConfirmationDetector } from "./SubmissionConfirmationDetector";

const SAP_SUCCESSFACTORS_SUBMIT_LABEL = /^(?:apply|submit(?: application)?|complete application)$/i;

function isSapSuccessFactorsHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "successfactors.com" ||
    normalized.endsWith(".successfactors.com") ||
    normalized === "hcm.ondemand.com" ||
    normalized.endsWith(".hcm.ondemand.com")
  );
}

function isCareerPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return normalized.includes("/career") || normalized.includes("/sfcareer/");
}

export class SapSuccessFactorsSubmitControlResolver {
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
      const dataAutomationId =
        (await control.getAttribute("data-automation-id"))?.trim().toLowerCase() ?? "";
      const ariaLabel = (await control.getAttribute("aria-label"))?.trim() ?? "";
      const text = (await control.innerText().catch(() => "")).trim();
      const value = (await control.getAttribute("value"))?.trim() ?? "";
      const label = ariaLabel || text || value;

      const isKnownSubmitControl =
        id === "apply" ||
        id === "submit" ||
        id === "submitapplication" ||
        name === "apply" ||
        name === "submit" ||
        name === "submitapplication" ||
        dataTestId === "apply" ||
        dataTestId === "submit" ||
        dataAutomationId === "apply" ||
        dataAutomationId === "submit";
      const isSubmitLabel = SAP_SUCCESSFACTORS_SUBMIT_LABEL.test(label);

      if (isKnownSubmitControl || isSubmitLabel) {
        matches.push(control);
      }
    }

    return matches.length === 1 ? matches[0] ?? null : null;
  }
}

export class SapSuccessFactorsApplicationAdapter implements ApplicationAdapter {
  readonly name = "sap-successfactors";

  constructor(
    private readonly submitResolver = new SapSuccessFactorsSubmitControlResolver(),
    private readonly confirmationDetector = new SubmissionConfirmationDetector()
  ) {}

  canHandle(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === "https:" &&
        isSapSuccessFactorsHost(parsed.hostname) &&
        isCareerPath(parsed.pathname)
      );
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
          "SAP SuccessFactors Apply control could not be uniquely verified; manual review required."
      };
    }

    try {
      await submitControl.click();
    } catch (error) {
      return {
        submitted: false,
        externalApplicationId: null,
        confirmationUrl: null,
        reason: `SAP SuccessFactors Apply control could not be clicked: ${
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
          "SAP SuccessFactors Apply control was clicked, but application confirmation could not be verified."
      };
    }

    return {
      submitted: true,
      externalApplicationId: null,
      confirmationUrl: confirmation.confirmationUrl,
      reason:
        confirmation.signal ?? "SAP SuccessFactors application submission was confirmed."
    };
  }
}
