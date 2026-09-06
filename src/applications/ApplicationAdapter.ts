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
  submit(
    page: Page,
    context: ApplicationContext
  ): Promise<ApplicationSubmissionResult>;
}

export class ApplicationAdapterRegistry {
  constructor(private readonly adapters: readonly ApplicationAdapter[]) {}

  resolve(url: string): ApplicationAdapter | null {
    const matches = this.adapters.filter((adapter) => adapter.canHandle(url));
    if (matches.length === 0) return null;

    // The generic adapter is deliberately a fallback. A specialized adapter
    // must always win regardless of registration order; multiple specialized
    // matches are treated as unsafe ambiguity and fail closed.
    const specializedMatches = matches.filter(
      (adapter) => adapter.name !== "generic-form"
    );

    if (specializedMatches.length === 1) {
      return specializedMatches[0] ?? null;
    }

    if (specializedMatches.length > 1) {
      return null;
    }

    return matches.find((adapter) => adapter.name === "generic-form") ?? null;
  }
}
