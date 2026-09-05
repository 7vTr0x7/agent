export interface ApplicationBrowserPage {
  goto(url: string): Promise<void>;
  url(): string;
}

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
  submit(
    page: ApplicationBrowserPage,
    context: ApplicationContext
  ): Promise<ApplicationSubmissionResult>;
}

export class ApplicationAdapterRegistry {
  constructor(private readonly adapters: readonly ApplicationAdapter[]) {}

  resolve(url: string): ApplicationAdapter | null {
    return this.adapters.find((adapter) => adapter.canHandle(url)) ?? null;
  }
}
