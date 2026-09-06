import { Page } from "playwright";
import {
  ApplicationAdapter,
  ApplicationContext,
  ApplicationSubmissionResult
} from "./ApplicationAdapter";
import { FormFieldDetector } from "./FormFieldDetector";
import { VerifiedSubmissionExecutor } from "./VerifiedSubmissionExecutor";
import { SubmissionConfirmationDetector } from "./SubmissionConfirmationDetector";
import { GreenhouseApplicationAdapter } from "./GreenhouseApplicationAdapter";
import { LeverApplicationAdapter } from "./LeverApplicationAdapter";
import { AshbyApplicationAdapter } from "./AshbyApplicationAdapter";
import { WorkdayApplicationAdapter } from "./WorkdayApplicationAdapter";
import { SmartRecruitersApplicationAdapter } from "./SmartRecruitersApplicationAdapter";
import { WorkableApplicationAdapter } from "./WorkableApplicationAdapter";
import { BambooHRApplicationAdapter } from "./BambooHRApplicationAdapter";
import { IcimsApplicationAdapter } from "./IcimsApplicationAdapter";
import { TaleoApplicationAdapter } from "./TaleoApplicationAdapter";
import { JobviteApplicationAdapter } from "./JobviteApplicationAdapter";
import { PinpointApplicationAdapter } from "./PinpointApplicationAdapter";
import { SapSuccessFactorsApplicationAdapter } from "./SapSuccessFactorsApplicationAdapter";

export class GenericApplicationAdapter implements ApplicationAdapter {
  readonly name = "generic-form";

  constructor(
    private readonly detector = new FormFieldDetector(),
    private readonly executor = new VerifiedSubmissionExecutor(),
    private readonly confirmationDetector = new SubmissionConfirmationDetector()
  ) {}

  canHandle(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  async submit(page: Page, context: ApplicationContext): Promise<ApplicationSubmissionResult> {
    if (new GreenhouseApplicationAdapter().canHandle(context.url)) {
      return new GreenhouseApplicationAdapter().submit(page, context);
    }

    if (new LeverApplicationAdapter().canHandle(context.url)) {
      return new LeverApplicationAdapter().submit(page, context);
    }

    if (new AshbyApplicationAdapter().canHandle(context.url)) {
      return new AshbyApplicationAdapter().submit(page, context);
    }

    if (new WorkdayApplicationAdapter().canHandle(context.url)) {
      return new WorkdayApplicationAdapter().submit(page, context);
    }

    if (new SmartRecruitersApplicationAdapter().canHandle(context.url)) {
      return new SmartRecruitersApplicationAdapter().submit(page, context);
    }

    if (new WorkableApplicationAdapter().canHandle(context.url)) {
      return new WorkableApplicationAdapter().submit(page, context);
    }

    if (new BambooHRApplicationAdapter().canHandle(context.url)) {
      return new BambooHRApplicationAdapter().submit(page, context);
    }

    if (new IcimsApplicationAdapter().canHandle(context.url)) {
      return new IcimsApplicationAdapter().submit(page, context);
    }

    if (new TaleoApplicationAdapter().canHandle(context.url)) {
      return new TaleoApplicationAdapter().submit(page, context);
    }

    if (new JobviteApplicationAdapter().canHandle(context.url)) {
      return new JobviteApplicationAdapter().submit(page, context);
    }

    if (new PinpointApplicationAdapter().canHandle(context.url)) {
      return new PinpointApplicationAdapter().submit(page, context);
    }

    if (new SapSuccessFactorsApplicationAdapter().canHandle(context.url)) {
      return new SapSuccessFactorsApplicationAdapter().submit(page, context);
    }

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

    const execution = await this.executor.execute(page);
    if (!execution.clicked) {
      return {
        submitted: false,
        externalApplicationId: null,
        confirmationUrl: null,
        reason: execution.reason
      };
    }

    const confirmation = await this.confirmationDetector.detect(page);
    if (!confirmation.confirmed) {
      return {
        submitted: false,
        externalApplicationId: null,
        confirmationUrl: null,
        reason: "Submit button was clicked, but application confirmation could not be verified."
      };
    }

    return {
      submitted: true,
      externalApplicationId: null,
      confirmationUrl: confirmation.confirmationUrl,
      reason: confirmation.signal ?? "Application submission was confirmed."
    };
  }
}
