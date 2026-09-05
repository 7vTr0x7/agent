import { Page } from "playwright";
import { ApplicationAdapter, ApplicationContext, ApplicationSubmissionResult } from "./ApplicationAdapter";
import { FormFieldDetector } from "./FormFieldDetector";

export class GenericApplicationAdapter implements ApplicationAdapter {
  readonly name = "generic-form";

  constructor(private readonly detector = new FormFieldDetector()) {}

  canHandle(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  async submit(page: Page, _context: ApplicationContext): Promise<ApplicationSubmissionResult> {
    await page.waitForLoadState("domcontentloaded");

    const fields = await this.detector.detect(page);
    const requiredUnknownFields = fields.filter(
      (field) => field.required && field.type === "unknown"
    );

    if (requiredUnknownFields.length > 0) {
      return {
        submitted: false,
        externalApplicationId: null,
        confirmationUrl: null,
        reason: "Required application fields could not be classified safely."
      };
    }

    return {
      submitted: false,
      externalApplicationId: null,
      confirmationUrl: null,
      reason: "Application form inspected successfully; submission requires a platform-specific field mapping."
    };
  }
}
