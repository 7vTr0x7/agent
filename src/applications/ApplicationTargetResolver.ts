import { Page } from "playwright";
import { validateApplicationNavigationUrl } from "./ApplicationUrlPolicy";

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
const APPLICATION_FIELD_SIGNAL = /(?:first\s*name|last\s*name|full\s*name|resume|cv|curriculum\s*vitae|cover\s*letter|phone|telephone|linkedin|github|portfolio|work\s*authorization|sponsorship|education|experience|current\s*company|current\s*title|salary|compensation|availability|application)/i;

async function hasAuthenticationUi(page: Page): Promise<boolean> {
  if (await page.locator('input[type="password"]:visible').count() > 0) return true;

  const authenticationFormCount = await page.locator("form:visible").evaluateAll((forms, authText) => {
    const authSignal = new RegExp(authText, "i");
    return forms.filter((form) => {
      const text = (form.textContent || "").trim();
      const controls = Array.from(form.querySelectorAll("input, button, [role='button']"));
      const controlText = controls
        .map((control) => (control.getAttribute("aria-label") || control.textContent || (control as HTMLInputElement).value || "").trim())
        .join(" ");
      const combined = `${text} ${controlText}`;
      const hasEmailField = Boolean(form.querySelector('input[type="email"], input[name*="email" i], input[autocomplete="email"]'));
      const hasPasswordField = Boolean(form.querySelector('input[type="password"]'));
      return hasPasswordField || (hasEmailField && authSignal.test(combined));
    }).length;
  }, AUTH_TEXT.source);

  return authenticationFormCount > 0;
}

async function hasApplicationForm(page: Page, startedFromJobPage: boolean): Promise<boolean> {
  const visibleForms = page.locator("form:visible");
  if (await visibleForms.count() === 0) return false;

  if (startedFromJobPage) {
    // Once an explicit Apply action has navigated us to a target page, a visible
    // form is sufficient. This keeps ATS-specific form shapes out of the target
    // resolver while preventing search/filter forms on the original job board
    // from being mistaken for an application.
    return true;
  }

  const applicationFormCount = await visibleForms.evaluateAll((forms, signalSource) => {
    const signal = new RegExp(signalSource, "i");
    return forms.filter((form) => {
      const text = (form.textContent || "").trim();
      const controls = Array.from(form.querySelectorAll("input, textarea, select, [contenteditable='true'], button, [role='button']"));
      const names = controls
        .map((control) => [
          control.getAttribute("name"),
          control.getAttribute("id"),
          control.getAttribute("placeholder"),
          control.getAttribute("aria-label"),
          control.textContent,
          (control as HTMLInputElement).value
        ].filter(Boolean).join(" "))
        .join(" ");
      return signal.test(`${text} ${names}`) && controls.length >= 1;
    }).length;
  }, APPLICATION_FIELD_SIGNAL.source);

  return applicationFormCount > 0;
}

export class ApplicationTargetResolver {
  async resolve(page: Page, sourceUrl: string): Promise<ApplicationTargetResolution> {
    let sourceHost: string | undefined;
    try { sourceHost = new URL(sourceUrl).hostname; } catch { /* resolveInternal reports the invalid URL */ }
    return this.resolveInternal(page, sourceUrl, false, sourceHost);
  }

  private async resolveInternal(
    page: Page,
    sourceUrl: string,
    startedFromJobPage: boolean,
    expectedHost?: string
  ): Promise<ApplicationTargetResolution> {
    const currentUrl = page.url();
    const effectiveUrl = currentUrl && currentUrl !== "about:blank" ? currentUrl : sourceUrl;
    const urlCheck = validateApplicationNavigationUrl(effectiveUrl, expectedHost);
    if (!urlCheck.allowed) {
      return { resolved: false, url: effectiveUrl, startedFromJobPage, reason: urlCheck.reason };
    }

    const parsedUrl = new URL(effectiveUrl);
    if (AUTH_PATH.test(parsedUrl.pathname)) {
      return {
        resolved: false,
        url: effectiveUrl,
        startedFromJobPage,
        reason: "Blocked because authentication or account-creation UI was detected; credentials must never be automated."
      };
    }

    if (await hasAuthenticationUi(page)) {
      return {
        resolved: false,
        url: effectiveUrl,
        startedFromJobPage,
        reason: "Blocked because authentication or account-creation UI was detected; credentials must never be automated."
      };
    }

    if (await hasApplicationForm(page, startedFromJobPage)) {
      return { resolved: true, url: effectiveUrl, startedFromJobPage, reason: "Application form is already present on the target page." };
    }

    const submitCount = await page.getByRole("button", { name: SUBMIT_NAME }).count()
      + await page.getByRole("link", { name: SUBMIT_NAME }).count();

    const fieldCount = await page.locator("input, textarea, select, [role='combobox'], [contenteditable='true']").count();
    if (submitCount > 0 && fieldCount > 0) {
      return { resolved: true, url: effectiveUrl, startedFromJobPage, reason: "Application controls are present on the target page." };
    }

    const candidates = await page.locator('a, button, input[type="submit"], input[type="button"]').evaluateAll((elements) =>
      elements.map((element, index) => ({
        index,
        name: (element.getAttribute("aria-label") || element.textContent || (element as HTMLInputElement).value || "").trim(),
        href: element instanceof HTMLAnchorElement ? element.href : null
      }))
    );

    const applyCandidates = candidates.filter(({ name }) => APPLY_NAME.test(name) && !EXCLUDED_APPLY_NAME.test(name));
    if (applyCandidates.length === 0) return { resolved: false, url: effectiveUrl, startedFromJobPage, reason: "No unambiguous application entry point was found." };
    if (applyCandidates.length > 1) return { resolved: false, url: effectiveUrl, startedFromJobPage, reason: "Multiple application entry points were found; manual review is required." };

    const candidate = applyCandidates[0];
    if (!candidate) return { resolved: false, url: effectiveUrl, startedFromJobPage, reason: "Application entry point could not be resolved safely; manual review is required." };

    const locator = page.locator('a, button, input[type="submit"], input[type="button"]').nth(candidate.index);

    if (candidate.href) {
      if (candidate.href === effectiveUrl) return { resolved: false, url: effectiveUrl, startedFromJobPage, reason: "The application link points back to the same page; manual review is required." };
      const candidateCheck = validateApplicationNavigationUrl(candidate.href);
      if (!candidateCheck.allowed) return { resolved: false, url: effectiveUrl, startedFromJobPage, reason: candidateCheck.reason };
      const candidateHost = new URL(candidate.href).hostname;
      await page.goto(candidate.href, { waitUntil: "domcontentloaded" });
      return this.resolveInternal(page, candidate.href, true, candidateHost);
    }

    try {
      await locator.scrollIntoViewIfNeeded().catch(() => undefined);
      const popupPromise = page.waitForEvent("popup", { timeout: 750 }).catch(() => null);
      await locator.click();
      const popup = await popupPromise;
      if (popup) {
        await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
        const popupHost = new URL(popup.url()).hostname;
        return this.resolveInternal(popup, popup.url(), true, popupHost);
      }
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    } catch (error) {
      return { resolved: false, url: effectiveUrl, startedFromJobPage, reason: `Application entry point could not be opened safely: ${error instanceof Error ? error.message : String(error)}` };
    }

    const nextUrl = page.url();
    if (!nextUrl || nextUrl === "about:blank") {
      return { resolved: false, url: effectiveUrl, startedFromJobPage, reason: "Application entry point did not navigate to a usable target; manual review is required." };
    }
    let nextHost: string;
    try { nextHost = new URL(nextUrl).hostname; } catch { return { resolved: false, url: nextUrl, startedFromJobPage, reason: "Application entry point navigated to an invalid target; manual review is required." }; }
    return this.resolveInternal(page, nextUrl, true, nextHost);
  }
}
