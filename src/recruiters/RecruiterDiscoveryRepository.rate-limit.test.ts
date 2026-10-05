import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";

function database(dayCount: string, hourCount: string, claimed = true): { db: any; client: any } {
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
  const db = {
    transaction: jest.fn().mockImplementation(async (callback: (transactionClient: any) => Promise<unknown>) => callback(client))
  };
  return { db, client };
}

describe("RecruiterDiscoveryRepository recruiter rate limit", () => {
  it("uses the daily budget when the hourly cap is disabled", async () => {
    const { db, client } = database("479", "999");
    const repository = new RecruiterDiscoveryRepository(db as never);

    await expect(repository.claimPreparedOutreachMessageWithinRateLimits("message-1", 480, 0)).resolves.toMatchObject({
      id: "message-1",
      status: "SENDING"
    });

    const countQuery = client.query.mock.calls[1][0] as string;
    expect(countQuery).toContain("send_state IN ('SENT','SENDING','AMBIGUOUS')");
    expect(countQuery).toContain("COALESCE(sent_at,send_started_at,send_claimed_at,updated_at)");
    expect(countQuery).toContain("24 hours");
  });

  it("blocks the 481st reserved daily slot even when there is no hourly cap", async () => {
    const { db, client } = database("480", "999");
    const repository = new RecruiterDiscoveryRepository(db as never);

    await expect(repository.claimPreparedOutreachMessageWithinRateLimits("message-481", 480, 0)).resolves.toBeNull();
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("does not block on the hourly count when the hourly cap is zero", async () => {
    const { db, client } = database("10", "999");
    const repository = new RecruiterDiscoveryRepository(db as never);

    await expect(repository.claimPreparedOutreachMessageWithinRateLimits("message-1", 480, 0)).resolves.toMatchObject({
      id: "message-1"
    });

    const guardQuery = client.query.mock.calls[1][0] as string;
    expect(guardQuery).toContain("24 hours");
    expect(guardQuery).toContain("1 hour");
    expect(client.query.mock.calls[2][0]).toContain("UPDATE recruiter_outreach_messages");
  });
});
