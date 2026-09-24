import { JobAgentApiServer } from "./JobAgentApiServer";
import { Database } from "../database/Database";

describe("JobAgentApiServer", () => {
  it("serves health and summary endpoints with real result records", async () => {
    const database = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT 1")) return { rows: [{ "?column?": 1 }] };
        if (sql.includes('SELECT s.id,c.full_name AS recruiter') && sql.includes("FROM recruiter_contact_sources s")) {
          return {
            rows: [{
              id: "source-1",
              recruiter: "Jane Doe",
              company: "Example Corp",
              role: "React Frontend Engineer",
              sourceUrl: "https://example.com/jobs/react-frontend",
              sourceType: "job_posting",
              confidence: 95,
              observedAt: "2026-09-24T12:00:00.000Z"
            }]
          };
        }
        return {
          rows: [{
            jobs: "12",
            matches: "8",
            applications: "3",
            recruiters: "2",
            outreachSent: "1",
            pendingTasks: "4",
            matchApply: "2",
            matchReview: "3",
            matchReject: "3",
            verifiedRecruiterEmails: "1",
            currentRecruiters: "1",
            recentRecruiters: "1",
            topMatches: [{
              company: "Example Corp",
              role: "React Frontend Engineer",
              location: "Bengaluru",
              url: "https://example.com/jobs/react-frontend",
              decision: "APPLY",
              score: 91,
              reason: "Strong React and TypeScript alignment."
            }],
            recruiterLeads: [{
              name: "Jane Doe",
              company: "Example Corp",
              role: "Technical Recruiter",
              relevance: "CURRENT",
              relevanceScore: 100,
              hiringEvidence: [],
              profileUrl: "https://example.com/talent/jane-doe",
              email: "jane@example.com",
              emailStatus: "VERIFIED",
              verified: true,
              mailboxEvidence: true,
              confidence: 92,
              eligibleForOutreach: true
            }]
          }]
        };
      })
    } as unknown as Database;
    const server = new JobAgentApiServer(database, { host: "127.0.0.1", port: 0 });

    await server.start();
    try {
      const address = server.getAddress();
      expect(address?.port).toBeGreaterThan(0);
      const baseUrl = `http://127.0.0.1:${address?.port}`;

      const health = await fetch(`${baseUrl}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok", database: "ok" });

      const summary = await fetch(`${baseUrl}/api/summary`);
      expect(summary.status).toBe(200);
      const body = await summary.json();
      expect(body).toEqual(expect.objectContaining({
        jobs: "12",
        matches: "8",
        applications: "3",
        recruiters: "2",
        outreachSent: "1",
        pendingTasks: "4",
        matchApply: "2",
        matchReview: "3",
        matchReject: "3",
        verifiedRecruiterEmails: "1"
      }));
      expect(body.topMatches).toEqual([expect.objectContaining({
        company: "Example Corp",
        role: "React Frontend Engineer",
        decision: "APPLY",
        score: 91
      })]);
      expect(body.recruiterLeads).toEqual([expect.objectContaining({
        name: "Jane Doe",
        company: "Example Corp",
        emailStatus: "VERIFIED",
        eligibleForOutreach: true
      })]);
      expect(JSON.stringify(body)).not.toContain("client_secret");
      expect(JSON.stringify(body)).not.toContain("refreshToken");
      const queryMock = database.query as unknown as jest.Mock;
      const summaryQuery = queryMock.mock.calls.find(([sql]: [unknown]) => String(sql).includes("match_decisions"))?.[0];
      expect(String(summaryQuery)).toContain('x."relevanceScore"');

      const content = await fetch(`${baseUrl}/api/content?limit=10`);
      expect(content.status).toBe(200);
      const contentBody = await content.json();
      expect(contentBody.content).toEqual([expect.objectContaining({
        id: "source-1",
        company: "Example Corp",
        role: "React Frontend Engineer",
        sourceType: "job_posting"
      })]);

      const contentQuery = queryMock.mock.calls.find(([sql]: [unknown]) => String(sql).includes("FROM recruiter_contact_sources s"))?.[0];
      expect(String(contentQuery)).not.toContain("s.evidence");
    } finally {
      await server.stop();
    }
  });
});
