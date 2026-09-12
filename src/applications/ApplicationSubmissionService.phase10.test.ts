import { ApplicationSubmissionService } from "./ApplicationSubmissionService";

describe("Phase 10 application live activation boundary", () => {
  it("does not submit when APPLICATION_LIVE_ENABLED is false even when dry-run is false", async () => {
    const page = { setDefaultNavigationTimeout: jest.fn(), setDefaultTimeout: jest.fn(), goto: jest.fn().mockResolvedValue(undefined) } as any;
    const browser = { create: jest.fn().mockResolvedValue({ page }), close: jest.fn().mockResolvedValue(undefined) } as any;
    const adapter = { name: "greenhouse", submit: jest.fn(), capabilities: { application: "ACTIVE" }, matches: () => true } as any;
    const adapters = { resolve: jest.fn().mockReturnValue(adapter) } as any;
    const applications = { beginSubmissionAttempt: jest.fn(), beginSubmission: jest.fn(), markSubmitted: jest.fn(), finalizeSubmissionAttempt: jest.fn(), updateSubmissionAttemptPhase: jest.fn() } as any;
    const targetResolver = { resolve: jest.fn().mockResolvedValue({ resolved: true, url: "http://127.0.0.1:18080/jobs/phase10" }) } as any;
    const flowController = { prepare: jest.fn().mockResolvedValue({ allowed: true, reasons: [] }) } as any;
    const service = new ApplicationSubmissionService(browser, adapters, applications, undefined, undefined, undefined, undefined, undefined, undefined, false, flowController, undefined, undefined, false);
    const result = await service.submit({ context: { applicationId: "application-1", url: "http://127.0.0.1:18080/jobs/phase10" } as any, companyName: "Example Corp", excludedCompanies: [], candidateProfile: {} as any });
    expect(result).toMatchObject({ submitted: false, outcome: "NOT_SUBMITTED", safetyAllowed: true, reason: "APPLICATION_LIVE_ENABLED is false; live application submission was not attempted." });
    expect(applications.beginSubmissionAttempt).not.toHaveBeenCalled();
    expect(adapter.submit).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
