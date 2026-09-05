import { Page } from "playwright";
import { SubmissionButtonResolver } from "./SubmissionButtonResolver";

export interface SubmissionExecutionResult {
  clicked: boolean;
  reason: string;
}

export class VerifiedSubmissionExecutor {
  constructor(
    private readonly resolver = new SubmissionButtonResolver()
  ) {}

  async execute(page: Page): Promise<SubmissionExecutionResult> {
    const resolved = await this.resolver.resolveVerified(page);

    if (!resolved.found || !resolved.locator) {
      return {
        clicked: false,
        reason: resolved.reason
      };
    }

    try {
      await resolved.locator.click();
      return {
        clicked: true,
        reason: "Verified submit button was clicked successfully."
      };
    } catch (error) {
      return {
        clicked: false,
        reason: `Verified submit button could not be clicked: ${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }
  }
}
