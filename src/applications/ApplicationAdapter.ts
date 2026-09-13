import { Page } from "playwright";
import { ApplicationAdapterCapabilities } from "./ApplicationAdapterCapabilities";

export type ApplicationSubmissionOutcome =
  | "CONFIRMED_SUCCESS"
  | "DEFINITIVE_FAILURE"
  | "AMBIGUOUS"
  | "NOT_SUBMITTED";

export interface ApplicationSubmissionEvidence {
  requestObserved: boolean;
  requestSentAt: Date | null;
  responseObserved: boolean;
  responseReceivedAt: Date | null;
  responseStatus: number | null;
  finalUrl: string;
}

export interface ApplicationContext {
  jobOpportunityId: string;
  candidateProfileId: string;
  applicationId: string;
  url: string;
}

export interface ApplicationSubmissionResult {
  /** Legacy compatibility field. The submission service derives the durable outcome. */
  submitted: boolean;
  /** Optional explicit adapter classification; the service validates it against evidence. */
  outcome?: ApplicationSubmissionOutcome;
  externalApplicationId: string | null;
  confirmationUrl: string | null;
  reason: string;
  evidence?: Partial<ApplicationSubmissionEvidence>;
}

export interface NormalizedApplicationSubmissionResult extends ApplicationSubmissionResult {
  outcome: ApplicationSubmissionOutcome;
  evidence: ApplicationSubmissionEvidence;
}

export function normalizeApplicationSubmissionResult(
  result: ApplicationSubmissionResult,
  evidence: ApplicationSubmissionEvidence
): NormalizedApplicationSubmissionResult {
  const explicit = result.outcome;

  if (explicit === "DEFINITIVE_FAILURE") {
    return { ...result, submitted: false, outcome: "DEFINITIVE_FAILURE", evidence };
  }

  if (explicit === "CONFIRMED_SUCCESS") {
    const hasConfirmationEvidence = Boolean(
      result.confirmationUrl?.trim() || result.externalApplicationId?.trim()
    );
    return {
      ...result,
      submitted: hasConfirmationEvidence,
      outcome: hasConfirmationEvidence ? "CONFIRMED_SUCCESS" : "AMBIGUOUS",
      evidence
    };
  }

  if (explicit === "AMBIGUOUS") {
    return { ...result, submitted: false, outcome: "AMBIGUOUS", evidence };
  }

  if (explicit === "NOT_SUBMITTED") {
    return {
      ...result,
      submitted: false,
      outcome: evidence.requestObserved ? "AMBIGUOUS" : "NOT_SUBMITTED",
      evidence
    };
  }

  if (result.submitted) {
    const hasConfirmationEvidence = Boolean(
      result.confirmationUrl?.trim() || result.externalApplicationId?.trim()
    );
    return {
      ...result,
      submitted: hasConfirmationEvidence,
      outcome: hasConfirmationEvidence ? "CONFIRMED_SUCCESS" : "AMBIGUOUS",
      evidence
    };
  }

  return {
    ...result,
    submitted: false,
    outcome: evidence.requestObserved ? "AMBIGUOUS" : "NOT_SUBMITTED",
    evidence
  };
}

export interface ApplicationAdapter {
  readonly name: string;
  readonly capabilities?: ApplicationAdapterCapabilities;
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

    const specializedMatches = matches.filter(
      (adapter) => adapter.name !== "generic-form"
    );

    if (specializedMatches.length === 1) return specializedMatches[0] ?? null;
    if (specializedMatches.length > 1) return null;
    return matches.find((adapter) => adapter.name === "generic-form") ?? null;
  }
}
