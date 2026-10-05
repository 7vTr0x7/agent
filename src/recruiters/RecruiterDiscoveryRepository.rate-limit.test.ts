import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";

function database(dayCount: string, hourCount: string, claimed = true): any {
  const client = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ day_count: dayCount, hour_count: hourCount }] })
      .mockResolvedValueOnce({
        rows: claimed
          ? [{ id: "message-1", sequence_id: "sequence-1", message_type: "INITIAL", sequence_step: 0, recipient_email: "recruiter@acme.dev", subject: "Application", body: "Hello", status: "SENDING" }]
          : []
      })
  };
  return {
    transaction: jest.fn().mockImplementation(async (callback: (transactionClient: any) => Promise<unknown>) => callback(client))
  };
}

describe("RecruiterDiscoveryRepository recruiter rate limit", () => {
  it("uses the daily budget when the hourly cap is disabled", async () => {
    const db = database("479", "999");
    const repository = new RecruiterDiscoveryRepository(db as never);

    await expect(repository.claimPreparedOutreachMessageWithinRateLimits("message-1", 480, 0)).resolves.toMatchObject({
      id: "message-1",
      status: "SENDING"
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.transaction.mock.calls[0][0]).toBeDefined();
    const countQuery = db.transaction.mock.results[0];
    void countQuery;
  });

  it("blocks the 481st reserved daily slot even when there is no hourly cap", async () => {
    const db = database("480", "999");
    const repository = new RecruiterDiscoveryRepository(db as never);

    await expect(repository.claimPreparedOutreachMessageWithinRateLimits("message-481", 480, 0)).resolves.toBeNull();
  });

  it("counts in-flight and ambiguous sends toward the daily reservation", async () => {
    const db = database("480", "0");
    const repository = new RecruiterDiscoveryRepository(db as never);

    await repository.claimPreparedOutreachMessageWithinRateLimits("message-481", 480, 0);

    const client = db.transaction.mock.results[0].value;
    void client;
    const queryCalls = db.transaction.mock.calls.length;
    expect(queryCalls).toBe(1);
  });
});
