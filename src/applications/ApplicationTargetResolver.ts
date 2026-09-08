import { Page } from "playwright";

export interface ApplicationTargetResolution {
  resolved: boolean;
  url: string;
  startedFromJobPage: boolean;
  reason: string;
}

const APPLY_NAME = /\bapply\b|easy apply|quick apply|応募(?:する)?/i;
const SUBMIT_NAME = /^(?:submit|submit application|send application|complete application)$/i;
const AUTH_PATH = /(?:^|\/)(?:login|log-in|signin|sign-in|signup|sign-up|register|registration)(?:\/|$)/i;
const AUTH_TEXT = /(?:sign in|sign-in|log in|log-in|create account|register|registration|forgot password)/i;
const EXCLUDED_APPLY_NAME = /^(?:privacy|privacy policy|policy|terms|help|support|jobs?|careers?|login|sign in|register|account|cookie)$/i;

export class ApplicationTargetResolver {
  async resolve(page: Page, sourceUrl: string): Promise<ApplicationTargetResolution> {
    return this.resolveInternal(page, sourceUrl, false);
  }

  private async resolveInternal(
    page: Page,
    sourceUrl: string,
    startedFromJobPage: boolean
  ): Promise<ApplicationTargetResolution> {
    const currentUrl = page.url();
    const effectiveUrl = currentUrl && currentUrl !== "about:blank" ? currentUrl : sourceUrl;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(effectiveUrl);
    } catch {
      return {
        resolved: false,
        url: effectiveUrl,
        startedFromJobPage,
        reason: "Application target URL is invalid; manual review is required."
      };
    }

    if (AUTH_PATH.test(parsedUrl.pathname)) {
      return {
        resolved: false,
        url: effectiveUrl,
        startedFromJobPage,
        reason: "Blocked because authentication or account-creation UI was detected; credentials must never be automated."
      };
    }

    const passwordCount = await page.locator('input[type="password"]').count();
    const formCount = await page.locator("form").count();
    const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 12000);
    if (passwordCount > 0 || (formCount > 0 && AUTH_TEXT.test(bodyText))) {
      return {
        resolved: false,
        url: effectiveUrl,
        startedFromJobPage,
        reason: "Blocked because authentication or account-creation UI was detected; credentials must never be automated."
      };
    }

    const fieldCount = await page.locator("input, textarea, select").count();
    const submitCount = await page.getByRole("button", { name: SUBMIT_NAME }).count()
      + await page.getByRole("link", { name: SUBMIT_NAME }).count();

    if (formCount > 0 || (fieldCount > 0 && submitCount > 0)) {
      return {
        resolved: true,
        url: effectiveUrl,
        startedFromJobPage,
        reason: "Application form is already present on the target page."
      };
    }

    const candidates = await page.locator('a, button, input[type="submit"], input[type="button"]').evaluateAll((elements) =>
      elements.map((element, index) => ({
        index,
        name: (element.getAttribute("aria-label") || element.textContent || (element as HTMLInputElement).value || "").trim(),
        href: element instanceof HTMLAnchorElement ? element.href : null
      }))
    );

    const applyCandidates = candidates.filter(({ name }) => APPLY_NAME.test(name) && !EXCLUDED_APPLY_NAME.test(name));

    if (applyCandidates.length === 0) {
      return {
        resolved: false,
        url: effectiveUrl,
        startedFromJobPage,
        reason: "No unambiguous application entry point was found."
      };
    }

    if (applyCandidates.length > 1) {
      return {
        resolved: false,
        url: effectiveUrl,
        startedFromJobPage,
        reason: "Multiple application entry points were found; manual review is required."
      };
    }

    const candidate = applyCandidates[0];
    if (!candidate) {
      return {
        resolved: false,
        url: effectiveUrl,
        startedFromJobPage,
        reason: "Application entry point could not be resolved safely; manual review is required."
      };
    }

    const locator = page.locator('a, button, input[type="submit"], input[type="button"]').nth(candidate.index);

    if (candidate.href) {
      if (candidate.href === effectiveUrl) {
        return {
          resolved: false,
          url: effectiveUrl,
          startedFromJobPage,
          reason: "The application link points back to the same page; manual review is required."
        };
      }
      await page.goto(candidate.href, { waitUntil: "domcontentloaded" });
      return this.resolveInternal(page, candidate.href, true);
    }

    try {
      await locator.click();
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    } catch (error) {
      return {
        resolved: false,
        url: effectiveUrl,
        startedFromJobPage,
        reason: `Application entry point could not be opened safely: ${error instanceof Error ? error.message : String(error)}`
      };
    }

    return this.resolveInternal(page, effectiveUrl, true);
  }
}
