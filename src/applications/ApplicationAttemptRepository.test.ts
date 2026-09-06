import { ApplicationAttemptRepository } from "./ApplicationAttemptRepository";

class FakeDatabase {
  readonly calls: Array<{ text: string; values: unknown[] }> = [];

  async query(text: string, values: unknown[]) {
    this.calls.push({ text, values });
    if (text.includes("INSERT INTO application_attempts")) {
      return {
        rows: [
          {
            id: "attempt-1",
            attempted_at: new Date("2026-09-06T10:00:00.000Z")
          }
        ]
      };
    }

    return {
      rows: [
        {
          id: "attempt-1",
          application_id: "application-1",
          adapter_name: "greenhouse",
          safety_allowed: true,
          submitted: true,
          reason: "Application submitted.",
          confirmation_url: "https://example.com/confirmation",
          external_application_id: "external-1",
          attempted_at: new Date("2026-09-06T10:00:00.000Z")
        }
      ]
    };
  }
}

describe("ApplicationAttemptRepository", () => {
  it("records an application attempt", async () => {
    const database = new FakeDatabase();
    const repository = new ApplicationAttemptRepository(database as never);
    const attemptedAt = new Date("2026-09-06T10:00:00.000Z");

    await expect(
      repository.record({
        applicationId: "application-1",
        adapterName: "greenhouse",
        safetyAllowed: true,
        submitted: true,
        reason: "Application submitted.",
        confirmationUrl: "https://example.com/confirmation",
        externalApplicationId: "external-1",
        attemptedAt
      })
    ).resolves.toEqual({
      applicationId: "application-1",
      adapterName: "greenhouse",
      safetyAllowed: true,
      submitted: true,
      reason: "Application submitted.",
      confirmationUrl: "https://example.com/confirmation",
      externalApplicationId: "external-1",
      attemptedAt,
      id: "attempt-1"
    });

    expect(database.calls[0]?.values).toEqual([
      "application-1",
      "greenhouse",
      true,
      true,
      "Application submitted.",
      "https://example.com/confirmation",
      "external-1",
      attemptedAt
    ]);
  });

  it("lists attempts newest first", async () => {
    const database = new FakeDatabase();
    const repository = new ApplicationAttemptRepository(database as never);

    await expect(repository.listForApplication("application-1")).resolves.toEqual([
      {
        id: "attempt-1",
        applicationId: "application-1",
        adapterName: "greenhouse",
        safetyAllowed: true,
        submitted: true,
        reason: "Application submitted.",
        confirmationUrl: "https://example.com/confirmation",
        externalApplicationId: "external-1",
        attemptedAt: new Date("2026-09-06T10:00:00.000Z")
      }
    ]);
  });
});
