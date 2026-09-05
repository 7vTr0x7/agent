import { BrowserSessionService } from "./BrowserSession";
import { ApplicationAdapterRegistry, ApplicationContext, ApplicationSubmissionResult } from "./ApplicationAdapter";
import { ApplicationFieldMapper } from "./ApplicationFieldMapper";
import { ApplicationFormFiller } from "./ApplicationFormFiller";
import { FormFieldDetector } from "./FormFieldDetector";
import { SubmissionSafetyGate } from "./SubmissionSafetyGate";
import { CandidateProfile } from "../candidates/CandidateProfile";

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
  result: ApplicationSubmissionResult | null;
}

export class ApplicationSubmissionService {
  constructor(
    private readonly browserSessions: BrowserSessionService,
    private readonly adapters: ApplicationAdapterRegistry,
    private readonly detector = new FormFieldDetector(),
    private readonly mapper = new ApplicationFieldMapper(),
    private readonly filler = new ApplicationFormFiller(),
    private readonly safetyGate = new SubmissionSafetyGate()
  ) {}

  async submit(request: ApplicationSubmissionRequest): Promise<ApplicationSubmissionOutcome> {
    const adapter = this.adapters.resolve(request.context.url);
    if (!adapter) {
      return {
        submitted: false,
        safetyAllowed: false,
        reason: "No application adapter can safely handle this URL.",
        result: null
      };
    }

    const session = await this.browserSessions.create();

    try {
      await session.page.goto(request.context.url, { waitUntil: "domcontentloaded" });

      const fields = await this.detector.detect(session.page);
      const mappings = this.mapper.map(fields, request.candidateProfile);
      const fillResult = await this.filler.fill(session.page, mappings);
      const safety = this.safetyGate.evaluate({
        url: request.context.url,
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
          result: null
        };
      }

      const result = await adapter.submit(session.page, request.context);
      return {
        submitted: result.submitted,
        safetyAllowed: true,
        reason: result.reason,
        result
      };
    } finally {
      await this.browserSessions.close(session);
    }
  }
}
