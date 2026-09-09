describe("loadConfig runtime loop intervals", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("uses safe defaults for configurable runtime loops", async () => {
    process.env.DATABASE_URL = "postgresql://test/test";
    process.env.APPLICATION_DRY_RUN = "true";
    process.env.OUTBOUND_ENABLED = "false";
    process.env.RECRUITER_OUTREACH_ACTIVATION = "disabled";
    delete process.env.APPLICATION_QUEUE_INTERVAL_MS;
    delete process.env.FOLLOW_UP_INTERVAL_MS;
    delete process.env.INTERVIEW_REMINDER_INTERVAL_MS;

    const { loadConfig } = await import("./env");
    const config = loadConfig();
    expect(config.applicationQueueIntervalMs).toBe(30_000);
    expect(config.followUpIntervalMs).toBe(300_000);
    expect(config.interviewReminderIntervalMs).toBe(300_000);
  });

  it("uses dry-run mode by default", async () => {
    process.env.DATABASE_URL = "postgresql://test/test";
    process.env.APPLICATION_DRY_RUN = "true";
    const { loadConfig } = await import("./env");
    expect(loadConfig().applicationDryRun).toBe(true);
  });

  it("uses autonomous dry-run defaults when activation variables are absent", async () => {
    process.env.DATABASE_URL = "postgresql://test/test";
    process.env.APPLICATION_DRY_RUN = "true";
    process.env.AUTOMATION_ENABLED = "true";
    process.env.OUTBOUND_ENABLED = "false";
    process.env.RECRUITER_OUTREACH_ENABLED = "false";
    process.env.RECRUITER_OUTREACH_ACTIVATION = "disabled";
    delete process.env.APPLICATION_RATE_LIMIT_PER_DAY;
    delete process.env.APPLICATION_COMPANY_RATE_LIMIT_PER_DAY;

    const { loadConfig } = await import("./env");
    const config = loadConfig();
    expect(config.automationEnabled).toBe(true);
    expect(config.applicationDryRun).toBe(true);
    expect(config.outboundEnabled).toBe(false);
    expect(config.applicationRateLimitPerDay).toBe(200);
    expect(config.applicationCompanyRateLimitPerDay).toBe(10);
    expect(config.recruiterOutreach.enabled).toBe(false);
    expect(config.recruiterOutreach.activation).toBe("disabled");
  });

  it("accepts an explicit application dry-run setting", async () => {
    process.env.DATABASE_URL = "postgresql://test/test";
    process.env.APPLICATION_DRY_RUN = "false";
    const { loadConfig } = await import("./env");
    expect(loadConfig().applicationDryRun).toBe(false);
  });

  it("accepts explicit positive runtime loop intervals", async () => {
    process.env.DATABASE_URL = "postgresql://test/test";
    process.env.APPLICATION_QUEUE_INTERVAL_MS = "45000";
    process.env.FOLLOW_UP_INTERVAL_MS = "600000";
    process.env.INTERVIEW_REMINDER_INTERVAL_MS = "180000";
    const { loadConfig } = await import("./env");
    const config = loadConfig();
    expect(config.applicationQueueIntervalMs).toBe(45_000);
    expect(config.followUpIntervalMs).toBe(600_000);
    expect(config.interviewReminderIntervalMs).toBe(180_000);
  });

  it("rejects non-positive runtime loop intervals", async () => {
    process.env.DATABASE_URL = "postgresql://test/test";
    process.env.APPLICATION_QUEUE_INTERVAL_MS = "0";
    const { loadConfig } = await import("./env");
    expect(() => loadConfig()).toThrow("APPLICATION_QUEUE_INTERVAL_MS must be a positive integer");
  });

  it("uses current, known-public RSS endpoints in the built-in discovery set", async () => {
    process.env.DATABASE_URL = "postgresql://test/test";
    delete process.env.JOB_SOURCES;

    const { loadConfig } = await import("./env");
    const sources = JSON.parse(loadConfig().jobSources) as Array<{ id: string; feedUrl?: string }>;
    const byId = new Map(sources.map((source) => [source.id, source]));

    expect(sources).toHaveLength(13);
    expect(byId.get("remotefirstjobs:react:rss")?.feedUrl).toBe("https://remotefirstjobs.com/rss/jobs/react.rss");
    expect(byId.get("remotefirstjobs:software:rss")?.feedUrl).toBe("https://remotefirstjobs.com/rss/jobs/software-development.rss");
    expect(byId.get("realworkfromanywhere:frontend:rss")?.feedUrl).toBe("https://www.realworkfromanywhere.com/remote-frontend-jobs/rss.xml");
    expect(byId.get("realworkfromanywhere:fullstack:rss")?.feedUrl).toBe("https://www.realworkfromanywhere.com/remote-fullstack-jobs/rss.xml");
    expect(byId.has("workanywhere:frontend:rss")).toBe(false);
    expect(byId.has("workanywhere:fullstack:rss")).toBe(false);
  });
});
