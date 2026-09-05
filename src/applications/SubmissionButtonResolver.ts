import { Locator, Page } from "playwright";

export interface SubmitButtonResolution {
  found: boolean;
  locator: Locator | null;
  reason: string;
}

const SUBMIT_PATTERNS = [
  /^submit(?: application)?$/i,
  /^apply(?: now)?$/i,
  /^send application$/i
];

export class SubmissionButtonResolver {
  resolve(page: Page): SubmitButtonResolution {
    const candidates = page.getByRole("button").filter({
      hasText: /^(submit(?: application)?|apply(?: now)?|send application)$/i
    });

    return {
      found: false,
      locator: candidates,
      reason: "Submit control must be resolved and verified before any click."
    };
  }

  async resolveVerified(page: Page): Promise<SubmitButtonResolution> {
    const buttons = page.getByRole("button");
    const count = await buttons.count();
    const matches: Locator[] = [];

    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      const text = (await button.innerText()).trim();
      if (SUBMIT_PATTERNS.some((pattern) => pattern.test(text))) {
        matches.push(button);
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
}
