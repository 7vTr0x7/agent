import { ProactiveRecruiterRepository } from "./ProactiveRecruiterRepository";
import { ProactiveRecruiterDiscoveryCandidate } from "./ProactiveRecruiterDiscoveryService";

const candidate = (overrides: Partial<ProactiveRecruiterDiscoveryCandidate> = {}): ProactiveRecruiterDiscoveryCandidate => ({
  recruiterName: "Jane Doe",
  recruiterRole: "Technical Recruiter",
  employer: "Acme",
  employerDomain: "acme.example",
  targetRoles: ["Frontend Engineer"],
  roleMatchScore: 90,
  hiringEvidenceScore: 90,
  overallConfidence: 95,
  discoverySource: "public-web",
  discoveryUrl: "https://linkedin.com/in/jane-doe",
  discoveryEvidence: ["Technical recruiter"],
  evidenceType: "public_profile",
  evidenceDate: new Date().toISOString(),
  evidenceFreshness: "current",
  emailStatus: "UNVERIFIED",
  ...overrides
});

describe("ProactiveRecruiterRepository", () => {
  it("persists recruiter identity and employer without requiring an email", async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: "contact-1" }] }).mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);
    const result = await repository.persistCandidate("candidate-1", candidate());
    expect(result).toBe("contact-1");
    const insertParams = database.query.mock.calls[1]?.[1] as unknown[];
    expect(insertParams?.[2]).toBeNull();
    expect(insertParams?.[14]).toBe("https://linkedin.com/in/jane-doe");
    expect(insertParams?.[15]).toBe("profile:https://linkedin.com/in/jane-doe");
  });

  it("does not derive mailbox evidence from VERIFIED status alone", async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: "contact-1" }] }).mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);
    await repository.persistCandidate("candidate-1", candidate({ email: "jane@acme.example", emailStatus: "VERIFIED" }));
    const params = database.query.mock.calls[1]?.[1] as unknown[];
    expect(params?.[6]).toBe(false);
    expect(params?.[11]).toBe(false);
    expect(params?.[12]).toBe("[]");
  });

  it("persists mailbox evidence only for explicit mailbox-level verification", async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: "contact-1" }] }).mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);
    const evidence = [{ provider: "snov", status: "valid", mailboxLevel: true, source: "snov" }];
    await repository.persistCandidate("candidate-1", candidate({ email: "jane@acme.example", emailStatus: "VERIFIED", verificationEvidence: evidence }));
    const params = database.query.mock.calls[1]?.[1] as unknown[];
    expect(params?.[6]).toBe(true);
    expect(params?.[7]).toBe("mailbox_verified");
    expect(params?.[11]).toBe(true);
    expect(params?.[12]).toBe(JSON.stringify(evidence));
  });

  it("enriches an existing recruiter identity with email without changing identity ownership", async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{ company_domain: "acme.example", relevance_status: "CURRENT" }] }).mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);
    await repository.enrichCandidateEmail({ recruiterContactId: "contact-1", email: "jane@acme.example", emailStatus: "LIKELY" });
    expect(database.query).toHaveBeenCalledTimes(2);
    expect(database.query.mock.calls[1]?.[0]).toContain("email_discovery_status");
  });

  it("uses the canonical database eligibility predicate before proactive campaign creation", async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: "contact-1" }] }).mockResolvedValueOnce({ rows: [{ email: "jane@acme.example" }] }).mockResolvedValueOnce({ rows: [{ exists: false }] }).mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);
    const result = await repository.createProactiveCampaign({ recruiterContactId: "contact-1", candidateProfileId: "candidate-1", targetRoles: ["Frontend Engineer"], subject: "Subject", body: "Body" });
    expect(result).toBeNull();
    const eligibilitySql = database.query.mock.calls[0]?.[0] as string;
    expect(eligibilitySql).toContain("mailbox_evidence");
    expect(eligibilitySql).toContain("verification_evidence");
    expect(eligibilitySql).toContain("email_status");
    expect(eligibilitySql).toContain("verification_status");
    expect(eligibilitySql).toContain("relevance_status");
    expect(eligibilitySql).toContain("recruiter_suppressions");
  });
});
