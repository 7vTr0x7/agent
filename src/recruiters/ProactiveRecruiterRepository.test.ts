import { ProactiveRecruiterRepository } from "./ProactiveRecruiterRepository";
import { ProactiveRecruiterDiscoveryCandidate } from "./ProactiveRecruiterDiscoveryService";

const hiringPostCandidate = (overrides: Partial<ProactiveRecruiterDiscoveryCandidate> = {}): ProactiveRecruiterDiscoveryCandidate => ({
  recruiterName: "Jane Doe",
  recruiterRole: "Technical Recruiter",
  employer: "Acme",
  employerDomain: "acme.example",
  targetRoles: ["Frontend Engineer"],
  roleMatchScore: 90,
  hiringEvidenceScore: 90,
  overallConfidence: 95,
  discoverySource: "public-web",
  discoveryUrl: "https://www.linkedin.com/posts/jane-doe_hiring-frontend-react-activity-1234567890123456789",
  discoveryEvidence: ["Jane Doe - Technical Recruiter at Acme. We are hiring frontend engineers in Bengaluru."],
  evidenceType: "job_hiring_evidence",
  evidenceDate: new Date().toISOString(),
  evidenceFreshness: "unknown",
  emailStatus: "UNVERIFIED",
  ...overrides
});

describe("ProactiveRecruiterRepository hiring-post persistence", () => {
  it("persists an identity-consistent named recruiter from a public hiring post without inventing a profile URL", async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "contact-post-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);

    const result = await repository.persistCandidate("candidate-1", hiringPostCandidate());

    expect(result).toBe("contact-post-1");
    const insertParams = database.query.mock.calls[1]?.[1] as unknown[];
    expect(insertParams?.[15]).toBeNull();
    expect(String(insertParams?.[16])).toContain("profile:");
    const sourceParams = database.query.mock.calls[2]?.[1] as unknown[];
    expect(sourceParams?.[2]).toBe("job_hiring_evidence");
  });

  it("rejects a search-engine result without genuine identity evidence", async () => {
    const database = { query: jest.fn() };
    const repository = new ProactiveRecruiterRepository(database as never);

    const result = await repository.persistCandidate("candidate-1", hiringPostCandidate({
      discoveryUrl: "https://www.bing.com/search?q=Jane+Doe+recruiter",
      discoveryEvidence: ["Jane Doe - Technical Recruiter at Acme"],
      hiringEvidenceScore: 0
    }));

    expect(result).toBeNull();
    expect(database.query).not.toHaveBeenCalled();
  });
});
