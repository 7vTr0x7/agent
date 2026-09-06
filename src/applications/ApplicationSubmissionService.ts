import { BrowserSessionService } from "./BrowserSession";
import { ApplicationAdapterRegistry, ApplicationContext, ApplicationSubmissionResult } from "./ApplicationAdapter";
import { ApplicationFieldMapper } from "./ApplicationFieldMapper";
import { ApplicationFormFiller } from "./ApplicationFormFiller";
import { FormFieldDetector } from "./FormFieldDetector";
import { SubmissionSafetyGate } from "./SubmissionSafetyGate";
import { ApplicationTargetResolver } from "./ApplicationTargetResolver";
import { ApplicationHazardDetector } from "./ApplicationHazardDetector";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { ApplicationRepository } from "./ApplicationRepository";

export interface ApplicationSubmissionRequest {
  context: ApplicationContext;
  companyName: string;
  excludedCompanies: readonly string[];
  candidateProfile: CandidateProfile;
}

export interface ApplicationSubmissionOutcome {
  submitted: boolean;
  safetyAllowed: boolean;
  reason: string;
  adapterName: string | null;
  result: ApplicationSubmissionResult | null;
}

export class ApplicationSubmissionService {
  constructor(
    private readonly browserSessions: BrowserSessionService,
    private readonly adapters: ApplicationAdapterRegistry,
    private readonly applications: Pick<ApplicationRepository, "beginSubmission" | "cancelSubmission" | "markSubmitted">,
    private readonly detector = new FormFieldDetector(),
    private readonly mapper = new ApplicationFieldMapper(),
    private readonly filler = new ApplicationFormFiller(),
    private readonly safetyGate = new SubmissionSafetyGate(),
    private readonly targetResolver = new ApplicationTargetResolver(),
    private readonly hazardDetector = new ApplicationHazardDetector(),
    private readonly dryRun = true
  ) {}

  async submit(request: ApplicationSubmissionRequest): Promise<ApplicationSubmissionOutcome> {
    const session = await this.browserSessions.create();

    try {
      await session.page.goto(request.context.url, { waitUntil: "domcontentloaded" });

      const target = await this.targetResolver.resolve(session.page, request.context.url);
      if (!target.resolved) {
        return {
          submitted: false,
          safetyAllowed: false,
          reason: target.reason,
          adapterName: null,
          result: null
        };
      }

      const adapter = this.adapters.resolve(target.url);
      if (!adapter) {
        return {
          submitted: false,
          safetyAllowed: false,
          reason: "No application adapter can safely handle the resolved application URL.",
          adapterName: null,
          result: null
        };
      }

      const hazards = await this.hazardDetector.detect(session.page);
      if (hazards.length > 0) {
        return {
          submitted: false,
          safetyAllowed: false,
          reason: hazards.map((hazard) => hazard.reason).join(" "),
          adapterName: adapter.name,
          result: null
        };
      }

      const resolvedContext: ApplicationContext = {
        ...request.context,
        url: target.url
      };

      const fields = await this.detector.detect(session.page);
      const mappings = this.mapper.map(fields, request.candidateProfile);
      const fillResult = await this.filler.fill(session.page, mappings);
      const safety = this.safetyGate.evaluate({
        url: target.url,
        companyName: request.companyName,
        excludedCompanies: request.excludedCompanies,
        mappings,
        fillResults: fillResult.results
      });

      if (!safety.allowed) {
        return {
          submitted: false,
          safetyAllowed: false,
          reason: safety.reasons.join(" "),
          adapterName: adapter.name,
          result: null
        };
      }

      if (this.dryRun) {
        return {
          submitted: false,
          safetyAllowed: true,
          reason: "Dry run completed: application page was resolved, hazards were clear, fields were mapped and filled, and the safety gate allowed submission. No application was submitted.",
          adapterName: adapter.name,
          result: null
        };
      }

      const reserved = await this.applications.beginSubmission(request.context.applicationId);
      if (!reserved) {
        return {
          submitted: false,
          safetyAllowed: true,
          reason: "Application submission is already in progress or has already been completed; automatic resubmission is blocked.",
          adapterName: adapter.name,
          result: null
        };
      }

      const result = await adapter.submit(session.page, resolvedContext);
      if (!result.submitted) {
        await this.applications.cancelSubmission(request.context.applicationId, result.reason);
        return {
          submitted: false,
          safetyAllowed: true,
          reason: result.reason,
          adapterName: adapter.name,
          result
        };
      }

      await this.applications.markSubmitted(
        request.context.applicationId,
        result.confirmationUrl,
        result.externalApplicationId
      );

      return {
        submitted: true,
        safetyAllowed: true,
        reason: result.reason,
        adapterName: adapter.name,
        result
      };
    } finally {
      await this.browserSessions.close(session);
    }
  }
}
