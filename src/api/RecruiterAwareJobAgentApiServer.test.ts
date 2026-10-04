import { RecruiterAwareJobAgentApiServer } from "./RecruiterAwareJobAgentApiServer";
import { Database } from "../database/Database";

describe("RecruiterAwareJobAgentApiServer P0 summary", () => {
  it("exposes public recruiter contacts without hiring-evidence fields or CURRENT/RECENT gating", async () => {
    const database = {
      query: jest.fn(async (sql: string) => {
        if (sql.trim() === "SELECT 1") return { rows: [{ "?column?": 1 }] };
        return {
          rows: [{
            jobs: "1",
            matches: "1",
            applications: "0",
            recruiters: "1",
            contacts: "1",
            content: "1",
            outreachSent: "0",
            pendingTasks: "0",
            matchApply: "0",
            matchReview: "1",
            matchReject: "0",
            verifiedRecruiterEmails: "0",
            eligibleRecruiterEmails: "1",
            currentRecruiters: "0",
            recentRecruiters: "0",
            topMatches: [],
            recruiterLeads: [{
              name: "Hiring Contact",
              company: "Example Corp",
              role: "Hiring contact",
              relevance: "UNKNOWN",
              relevanceScore: 75,
              profileUrl: "https://example.com/careers",
              sourceType: "public_contact_resource",
              email: "recruiter@example.com",
              emailStatus: "LIKELY",
              verified: false,
              mailboxEvidence: false,
              confidence: 75,
              eligibleForOutreach: true
            }]
          }]
        };
      })
    } as unknown as Database;

    const server = new RecruiterAwareJobAgentApiServer(database, { host: "127.0.0.1", port: 0 });
    await server.start();
    try {
      const address = server.getAddress();
      const response = await fetch(`http://127.0.0.1:${address?.port}/api/summary`);
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.recruiterLeads).toEqual([expect.objectContaining({
        email: "recruiter@example.com",
        sourceType: "public_contact_resource",
        relevance: "UNKNOWN",
        eligibleForOutreach: true
      })]);

      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("hiringEvidence");
      expect(serialized).not.toContain("job_hiring_evidence");

      const queryMock = database.query as unknown as jest.Mock;
      const summaryQuery = queryMock.mock.calls.find(([sql]: [unknown]) => String(sql).includes("recruiterLeads"))?.[0];
      expect(String(summaryQuery)).not.toContain('AS "hiringEvidence"');
      expect(String(summaryQuery)).not.toContain('AS "hiringEvidence"');
      expect(String(summaryQuery)).toContain("public_contact_resource");
      expect(String(summaryQuery)).toContain("'UNKNOWN'");
    } finally {
      await server.stop();
    }
  });
});
