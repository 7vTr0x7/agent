describe("recruiter activation configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = "postgresql://test/test";
    process.env.OUTBOUND_ENABLED = "false";
    process.env.EMAIL_ENABLED = "false";
    process.env.GMAIL_ENABLED = "false";
    process.env.RECRUITER_OUTREACH_ENABLED = "false";
    process.env.RECRUITER_OUTREACH_DRY_RUN = "true";
    process.env.RECRUITER_LIVE_ACTIVATION_CONFIRMED = "false";
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("defaults recruiter activation to disabled", async () => {
    process.env.RECRUITER_OUTREACH_ACTIVATION = "disabled";
    const { loadConfig } = await import("./env");
    const config = loadConfig();
    expect(config.recruiterOutreach.activation).toBe("disabled");
    expect(config.recruiterOutreach.liveActivationConfirmed).toBe(false);
  });

  it("accepts canary activation without enabling live confirmation", async () => {
    process.env.RECRUITER_OUTREACH_ACTIVATION = "canary";
    const { loadConfig } = await import("./env");
    expect(loadConfig().recruiterOutreach.activation).toBe("canary");
  });

  it("rejects unknown activation modes", async () => {
    process.env.RECRUITER_OUTREACH_ACTIVATION = "automatic";
    const { loadConfig } = await import("./env");
    expect(() => loadConfig()).toThrow("RECRUITER_OUTREACH_ACTIVATION must be disabled, canary, or live");
  });
});