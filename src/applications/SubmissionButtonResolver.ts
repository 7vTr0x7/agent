import { Locator, Page } from "playwright";

export interface SubmitButtonResolution {
  found: boolean;
  locator: Locator | null;
  reason: string;
}

const SUBMIT_PATTERNS = [
  /^submit(?: application)?$/i,
  /^apply(?: now)?$/i,
  /^send application$/i,
  /^finish application$/i,
  /^complete application$/i,
  /^complete and submit$/i,
  /^finish and submit$/i
];

function isSubmitLabel(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  return SUBMIT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export class SubmissionButtonResolver {
  resolve(page: Page): SubmitButtonResolution {
    const candidates = page
      .locator('button, input[type="submit"], input[type="image"]')
      .filter({ hasText: /^(submit(?: application)?|apply(?: now)?|send application|finish application|complete application|complete and submit|finish and submit)$/i });

    return {
      found: false,
      locator: candidates,
      reason: "Submit control must be resolved and verified before any click."
    };
  }

  async resolveVerified(page: Page): Promise<SubmitButtonResolution> {
    const controls = page.locator(
      'button, input[type="submit"], input[type="image"]'
    );
    const count = await controls.count();
    const matches: Locator[] = [];

    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      const text = await this.readAccessibleLabel(control);

      if (isSubmitLabel(text)) {
        matches.push(control);
      }
    }

    if (matches.length !== 1) {
      return {
        found: false,
        locator: null,
        reason:
          matches.length === 0
            ? "Could not identify a unique submit button."
            : "Multiple possible submit buttons were found; manual review required."
      };
    }

    const button = matches[0];
    if (!button) {
      return {
        found: false,
        locator: null,
        reason: "Submit button could not be resolved safely."
      };
    }

    if (!(await button.isVisible()) || !(await button.isEnabled())) {
      return {
        found: false,
        locator: null,
        reason: "The submit button is not visible and enabled."
      };
    }

    return {
      found: true,
      locator: button,
      reason: "A unique visible and enabled submit button was verified."
    };
  }

  private async readAccessibleLabel(control: Locator): Promise<string> {
    const text = (await control.innerText().catch(() => "")).trim();
    if (text) return text;

    const value = ((await control.getAttribute("value")) ?? "").trim();
    if (value) return value;

    const ariaLabel = ((await control.getAttribute("aria-label")) ?? "").trim();
    if (ariaLabel) return ariaLabel;

    return ((await control.getAttribute("title")) ?? "").trim();
  }
}
