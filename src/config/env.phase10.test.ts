describe("Phase 10 activation defaults", () => {
  const original = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...original, DATABASE_URL: "postgres://job_agent:test@localhost:5432/job_agent", CANDIDATE_PROFILE_ID: "test" };
  });

  afterAll(() => { process.env = original; });

  it("keeps live application, Gmail, outbound, proactive discovery, and proactive send disabled by default", async () => {
    delete process.env.APPLICATION_LIVE_ENABLED;
    delete process.env.GMAIL_ENABLED;
    delete process.env.OUTBOUND_ENABLED;
    delete process.env.PROACTIVE_RECRUITER_ENABLED;
    delete process.env.PROACTIVE_RECRUITER_SEND_ENABLED;
    delete process.env.APPLICATION_DRY_RUN;
    delete process.env.RECRUITER_OUTREACH_DRY_RUN;
    const { loadConfig } = await import("./env");
    const config = loadConfig();
    expect(config.applicationLiveEnabled).toBe(false);
    expect(config.applicationDryRun).toBe(true);
    expect(config.gmail.enabled).toBe(false);
    expect(config.outboundEnabled).toBe(false);
    expect(config.proactiveRecruiter.enabled).toBe(false);
    expect(config.proactiveRecruiter.sendEnabled).toBe(false);
    expect(config.recruiterOutreach.dryRun).toBe(true);
    expect(config.recruiterOutreach.requireVerifiedEmail).toBe(true);
  });
});
