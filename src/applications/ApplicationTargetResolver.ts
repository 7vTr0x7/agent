import { Page } from "playwright";

export interface ApplicationTargetResolution {
  resolved: boolean;
  url: string;
  startedFromJobPage: boolean;
  reason: string;
}

const APPLY_NAME = /^(?:apply|apply now|apply here|apply on company site|apply externally|easy apply|quick apply|応募|応募する)$/i;
const SUBMIT_NAME = /^(?:submit|submit application|send application|complete application)$/i;
const AUTH_PATH = /(?:^|\/)(?:login|log-in|signin|sign-in|signup|sign-up|register|registration)(?:\/|$)/i;
const AUTH_TEXT = /(?:sign in|sign-in|log in|log-in|create account|register|registration|forgot password)/i;

export class ApplicationTargetResolver {
  async resolve(page: Page, sourceUrl: string): Promise<ApplicationTargetResolution> {
    const currentUrl = page.url() || sourceUrl;

    if (AUTH_PATH.test(new URL(currentUrl).pathname)) {
      return {
        resolved: false,
        url: currentUrl,
        startedFromJobPage: true,
        reason: "Application target resolved to an authentication page; credentials must never be automated."
      };
    }

    const passwordCount = await page.locator('input[type="password"]').count();
    const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 12000);
    if (passwordCount > 0 || AUTH_TEXT.test(bodyText)) {
      return {
        resolved: false,
        url: currentUrl,
        startedFromJobPage: true,
        reason: "Authentication or account-creation UI was detected; credentials must never be automated."
      };
    }

    const formCount = await page.locator("form").count();
    const fieldCount = await page.locator("input, textarea, select").count();
    const submitCount = await page.getByRole("button", { name: SUBMIT_NAME }).count()
      + await page.getByRole("link", { name: SUBMIT_NAME }).count();

    if (formCount > 0 || (fieldCount > 0 && submitCount > 0)) {
      return {
        resolved: true,
        url: currentUrl,
        startedFromJobPage: false,
        reason: "Application form is already present on the target page."
      };
    }

    const links = page.getByRole("link", { name: APPLY_NAME });
    const buttons = page.getByRole("button", { name: APPLY_NAME });
    const linkCount = await links.count();
    const buttonCount = await buttons.count();
    const total = linkCount + buttonCount;

    if (total === 0) {
      return {
        resolved: false,
        url: currentUrl,
        startedFromJobPage: true,
        reason: "No unambiguous application entry point was found."
      };
    }

    if (total > 1) {
      return {
        resolved: false,
        url: currentUrl,
        startedFromJobPage: true,
        reason: "Multiple application entry points were found; manual review is required."
      };
    }

    if (linkCount === 1) {
      const href = await links.getAttribute("href");
      if (!href) {
        return {
          resolved: false,
          url: currentUrl,
          startedFromJobPage: true,
          reason: "The application link has no destination URL."
        };
      }

      const targetUrl = new URL(href, currentUrl).toString();
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      return this.resolve(page, targetUrl);
    }

    try {
      await buttons.click();
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    } catch (error) {
      return {
        resolved: false,
        url: currentUrl,
        startedFromJobPage: true,
        reason: `Application entry point could not be opened safely: ${error instanceof Error ? error.message : String(error)}`
      };
    }

    return this.resolve(page, currentUrl);
  }
}
