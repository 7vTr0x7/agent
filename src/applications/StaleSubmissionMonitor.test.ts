import { StaleSubmissionMonitor } from "./StaleSubmissionMonitor";

const staleSubmission = {
  applicationId: "application-stale-1",
  candidateProfileId: "candidate-1",
  companyName: "Example Co",
  startedAt: new Date("2026-09-06T10:00:00.000Z")
};

describe("StaleSubmissionMonitor", () => {
  const originalReconciliationSetting = process.env.STALE_SUBMISSION_RECONCILIATION_ENABLED;

  beforeEach(() => {
    // These tests exercise the reporting behavior explicitly; production defaults
    // remain safe-by-default with stale reconciliation disabled.
    process.env.STALE_SUBMISSION_RECONCILIATION_ENABLED = "true";
  });

  afterEach(() => {
    if (originalReconciliationSetting === undefined) {
      delete process.env.STALE_SUBMISSION_RECONCILIATION_ENABLED;
    } else {
      process.env.STALE_SUBMISSION_RECONCILIATION_ENABLED = originalReconciliationSetting;
    }
  });

  it("reports stale submissions without mutating them", async () => {
    const listStaleSubmissions = jest.fn().mockResolvedValue([staleSubmission]);
    const logger = {
      info: jest.fn(),
      warn: jest.fn()
    };
    const monitor = new StaleSubmissionMonitor(
      { listStaleSubmissions },
      logger,
      30
    );

    await expect(monitor.runOnce()).resolves.toEqual({
      staleCount: 1,
      submissions: [staleSubmission],
      requeued: 0
    });
    expect(listStaleSubmissions).toHaveBeenCalledWith(30);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        staleCount: 1,
        applicationIds: ["application-stale-1"]
      }),
      "Stale application submissions detected; manual verification required"
    );
  });

  it("reports a clean check when no submissions are stale", async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn()
    };
    const monitor = new StaleSubmissionMonitor(
      { listStaleSubmissions: jest.fn().mockResolvedValue([]) },
      logger,
      30
    );

    await expect(monitor.runOnce()).resolves.toEqual({
      staleCount: 0,
      submissions: [],
      requeued: 0
    });
    expect(logger.info).toHaveBeenCalledWith(
      { staleCount: 0 },
      "Stale application submission check completed"
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("fails fast for an invalid threshold", () => {
    expect(
      () =>
        new StaleSubmissionMonitor(
          { listStaleSubmissions: jest.fn() },
          { info: jest.fn(), warn: jest.fn() },
          0
        )
    ).toThrow("olderThanMinutes must be a positive finite number.");
  });

  it("does not swallow repository failures", async () => {
    const error = new Error("database unavailable");
    const listStaleSubmissions = jest.fn().mockRejectedValue(error);
    const logger = {
      info: jest.fn(),
      warn: jest.fn()
    };
    const monitor = new StaleSubmissionMonitor(
      { listStaleSubmissions },
      logger,
      30
    );

    await expect(monitor.runOnce()).rejects.toBe(error);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
