import { Page } from "playwright";

export interface ApplicationContext {
  jobOpportunityId: string;
  candidateProfileId: string;
  applicationId: string;
  url: string;
}

export interface ApplicationSubmissionResult {
  submitted: boolean;
  externalApplicationId: string | null;
  confirmationUrl: string | null;
  reason: string;
}

export interface ApplicationAdapter {
  readonly name: string;
  canHandle(url: string): boolean;
  submit(page: Page, context: ApplicationContext): Promise<ApplicationSubmissionResult>;
}

export class ApplicationAdapterRegistry {
  constructor(private readonly adapters: readonly ApplicationAdapter[]) {}

  resolve(url: string): ApplicationAdapter | null {
    return this.adapters.find((adapter) => adapter.canHandle(url)) ?? null;
  }
}
