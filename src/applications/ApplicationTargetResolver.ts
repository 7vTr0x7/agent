import { Page } from "playwright";

export interface ApplicationTargetResolution {
  resolved: boolean;
  url: string;
  startedFromJobPage: boolean;
  reason: string;
}

const APPLY_NAME = /^(?:apply|apply now|apply here|apply on company site|apply externally|easy apply|quick apply|応募|応募する)$/i;

export class ApplicationTargetResolver {
  async resolve(page: Page, sourceUrl: string): Promise<ApplicationTargetResolution> {
    const currentUrl = page.url() || sourceUrl;

    const formControls = page.locator("input, textarea, select");
    if (await formControls.count() > 0) {
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
      const link = links;
      const href = await link.getAttribute("href");
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
      return {
        resolved: true,
        url: page.url() || targetUrl,
        startedFromJobPage: true,
        reason: "Application target resolved from a verified application link."
      };
    }

    const button = buttons;
    try {
      await button.click();
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    } catch (error) {
      return {
        resolved: false,
        url: currentUrl,
        startedFromJobPage: true,
        reason: `Application entry point could not be opened safely: ${error instanceof Error ? error.message : String(error)}`
      };
    }

    return {
      resolved: true,
      url: page.url() || currentUrl,
      startedFromJobPage: true,
      reason: "Application target resolved from a verified application button."
    };
  }
}
