import { StaleSubmissionMonitor } from "./StaleSubmissionMonitor";

describe("StaleSubmissionMonitor safe runtime", () => {
  const original = process.env.STALE_SUBMISSION_RECONCILIATION_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.STALE_SUBMISSION_RECONCILIATION_ENABLED;
    else process.env.STALE_SUBMISSION_RECONCILIATION_ENABLED = original;
  });

  it("does not inspect or reconcile stale applications when explicitly disabled", async () => {
    process.env.STALE_SUBMISSION_RECONCILIATION_ENABLED = "false";
    const repository = {
      listStaleSubmissions: jest.fn(),
      reconcileStaleSubmissions: jest.fn()
    };
    const logger = { info: jest.fn(), warn: jest.fn() };
    const monitor = new StaleSubmissionMonitor(repository, logger, 30);

    await expect(monitor.runOnce()).resolves.toEqual({ staleCount: 0, submissions: [], requeued: 0 });
    expect(repository.listStaleSubmissions).not.toHaveBeenCalled();
    expect(repository.reconcileStaleSubmissions).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { staleCount: 0, reconciliationEnabled: false },
      "Stale application reconciliation is disabled"
    );
  });

  it("keeps reconciliation available when explicitly enabled", async () => {
    process.env.STALE_SUBMISSION_RECONCILIATION_ENABLED = "true";
    const repository = {
      listStaleSubmissions: jest.fn().mockResolvedValue([]),
      reconcileStaleSubmissions: jest.fn()
    };
    const logger = { info: jest.fn(), warn: jest.fn() };
    const monitor = new StaleSubmissionMonitor(repository, logger, 30);

    await expect(monitor.runOnce()).resolves.toEqual({ staleCount: 0, submissions: [], requeued: 0 });
    expect(repository.listStaleSubmissions).toHaveBeenCalledWith(30);
    expect(repository.reconcileStaleSubmissions).not.toHaveBeenCalled();
  });
});
