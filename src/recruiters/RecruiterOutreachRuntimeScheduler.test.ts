import { RecruiterOutreachRuntimeScheduler } from "./RecruiterOutreachRuntimeScheduler";

describe("RecruiterOutreachRuntimeScheduler", () => {
  it("runs reconciliation and follow-up scheduling independently", async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const reconciliationService = { runOnce: jest.fn().mockResolvedValue({ inspected: 2, reconciled: 1, unresolved: 1 }) };
    const followUpScheduler = { runOnce: jest.fn().mockResolvedValue({ prepared: 2, queued: 2, failed: 0 }) };

    const result = await new RecruiterOutreachRuntimeScheduler({} as never, followUpScheduler as never, reconciliationService as never, logger).runOnce();

    expect(result).toEqual({
      followUps: { prepared: 2, queued: 2, failed: 0 },
      reconciliation: { inspected: 2, reconciled: 1, unresolved: 1 },
      preparedSend: { inspected: 0, queued: 0, failed: 0 },
    });
    expect(reconciliationService.runOnce).toHaveBeenCalledTimes(1);
    expect(followUpScheduler.runOnce).toHaveBeenCalledTimes(1);
  });

  it("continues follow-up scheduling when reconciliation fails", async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const reconciliationService = { runOnce: jest.fn().mockRejectedValue(new Error("gmail unavailable")) };
    const followUpScheduler = { runOnce: jest.fn().mockResolvedValue({ prepared: 1, queued: 1, failed: 0 }) };

    const result = await new RecruiterOutreachRuntimeScheduler({} as never, followUpScheduler as never, reconciliationService as never, logger).runOnce();

    expect(result.followUps).toEqual({ prepared: 1, queued: 1, failed: 0 });
    expect(result.preparedSend).toEqual({ inspected: 0, queued: 0, failed: 0 });
    expect(result.reconciliation).toEqual({ inspected: 0, reconciled: 0, unresolved: 0 });
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), "Recruiter outreach send reconciliation failed");
  });

  it("continues reconciliation when follow-up scheduling fails", async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const reconciliationService = { runOnce: jest.fn().mockResolvedValue({ inspected: 1, reconciled: 1, unresolved: 0 }) };
    const followUpScheduler = { runOnce: jest.fn().mockRejectedValue(new Error("queue unavailable")) };

    const result = await new RecruiterOutreachRuntimeScheduler({} as never, followUpScheduler as never, reconciliationService as never, logger).runOnce();

    expect(result.reconciliation).toEqual({ inspected: 1, reconciled: 1, unresolved: 0 });
    expect(result.preparedSend).toEqual({ inspected: 0, queued: 0, failed: 0 });
    expect(result.followUps).toEqual({ prepared: 0, queued: 0, failed: 0 });
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), "Recruiter outreach follow-up scheduling failed");
  });

  it("preserves partial follow-up queue failures", async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const reconciliationService = { runOnce: jest.fn().mockResolvedValue({ inspected: 0, reconciled: 0, unresolved: 0 }) };
    const followUpScheduler = { runOnce: jest.fn().mockResolvedValue({ prepared: 3, queued: 2, failed: 1 }) };

    const result = await new RecruiterOutreachRuntimeScheduler({} as never, followUpScheduler as never, reconciliationService as never, logger).runOnce();

    expect(result.followUps).toEqual({ prepared: 3, queued: 2, failed: 1 });
    expect(result.preparedSend).toEqual({ inspected: 0, queued: 0, failed: 0 });
    expect(logger.info).toHaveBeenCalledWith(
      { prepared: 3, queued: 2, failed: 1 },
      "Recruiter outreach follow-up scheduling completed"
    );
  });


  it("queues existing prepared messages when send capacity is available", async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const repository = { listPreparedOutreachMessagesForSend: jest.fn().mockResolvedValue([
      { id: "m1", companyDomain: "example.com" },
      { id: "m2", companyDomain: "example.org" },
    ]) };
    const dispatcher = { enqueue: jest.fn().mockResolvedValue("task") };
    const scheduler = new RecruiterOutreachRuntimeScheduler(repository as never, undefined, undefined, logger, dispatcher as never, 2, 0);

    const result = await scheduler.runOnce();

    expect(repository.listPreparedOutreachMessagesForSend).toHaveBeenCalledWith(2, 2, 0);
    expect(dispatcher.enqueue).toHaveBeenCalledTimes(2);
    expect(result.preparedSend).toEqual({ inspected: 2, queued: 2, failed: 0 });
  });

  it("is a no-op when recruiter maintenance is not configured", async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const result = await new RecruiterOutreachRuntimeScheduler({} as never, undefined, undefined, logger).runOnce();

    expect(result).toEqual({
      followUps: { prepared: 0, queued: 0, failed: 0 },
      reconciliation: { inspected: 0, reconciled: 0, unresolved: 0 },
      preparedSend: { inspected: 0, queued: 0, failed: 0 },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
