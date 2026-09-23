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
  email: "jane@acme.example",
  emailStatus: "VERIFIED",
  ...overrides
});

describe("ProactiveRecruiterRepository", () => {
  it("does not derive mailbox evidence from VERIFIED status alone", async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "contact-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);

    await repository.persistCandidate("candidate-1", candidate());

    const params = database.query.mock.calls[1]?.[1] as unknown[];
    expect(params?.[6]).toBe(false);
    expect(params?.[12]).toBe(false);
    expect(params?.[13]).toBe("[]");
  });

  it("persists mailbox evidence only for explicit mailbox-level verification", async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "contact-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);
    const evidence = [{ provider: "snov", status: "valid", mailboxLevel: true, source: "snov" }];

    await repository.persistCandidate("candidate-1", candidate({ verificationEvidence: evidence }));

    const params = database.query.mock.calls[1]?.[1] as unknown[];
    expect(params?.[6]).toBe(true);
    expect(params?.[7]).toBe("mailbox_verified");
    expect(params?.[12]).toBe(true);
    expect(params?.[13]).toBe(JSON.stringify(evidence));
  });

  it("persists a real recruiter identity without requiring an email", async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "contact-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);

    const result = await repository.persistCandidate("candidate-1", candidate({
      email: undefined,
      emailStatus: "UNVERIFIED",
      discoveryUrl: "https://www.linkedin.com/in/jane-doe"
    }));

    expect(result).toBe("contact-1");
    const params = database.query.mock.calls[1]?.[1] as unknown[];
    expect(params?.[2]).toBeNull();
    expect(params?.[6]).toBe(false);
    expect(params?.[17]).toBe("PENDING");
    const insertSql = database.query.mock.calls[1]?.[0] as string;
    expect(insertSql).toContain("identity_key");
    expect(insertSql).toContain("linkedin_profile_url");
  });

  it("converges repeated identity evidence without an email into one contact", async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: "contact-1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "contact-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);

    const result = await repository.persistCandidate("candidate-1", candidate({
      email: undefined,
      emailStatus: "UNVERIFIED",
      discoveryUrl: "https://linkedin.com/in/jane-doe"
    }));

    expect(result).toBe("contact-1");
    const updateSql = database.query.mock.calls[1]?.[0] as string;
    expect(updateSql).toContain("identity_key=COALESCE");
    expect(updateSql).toContain("email_discovery_status");
  });

  it("persists an employer recruiting contact without inventing a person identity", async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "contact-employer-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);

    const result = await repository.persistCandidate("candidate-1", candidate({
      contactType: "EMPLOYER",
      recruiterName: "Employer recruiting contact",
      recruiterRole: "Employer recruiting contact",
      employer: "Nextgraph",
      employerDomain: "nextgraph.org",
      email: "job@nextgraph.org",
      emailStatus: "UNVERIFIED",
      discoveryUrl: "https://nextgraph.org/hiring-frontend-developer",
      discoveryEvidence: ["We are hiring a front-end developer - React, Svelte", "job@nextgraph.org"],
      evidenceType: "job_hiring_evidence"
    }));

    expect(result).toBe("contact-employer-1");
    const params = database.query.mock.calls[1]?.[1] as unknown[];
    expect(params?.[2]).toBe("job@nextgraph.org");
    expect(params?.[3]).toBeNull();
    expect(params?.[4]).toBeNull();
    expect(params?.[16]).toBe("email:job@nextgraph.org");
    const insertSql = database.query.mock.calls[1]?.[0] as string;
    expect(insertSql).toContain("full_name");
    expect(insertSql).toContain("title");
    const relevanceEvidenceSql = database.query.mock.calls[3]?.[1] as unknown[];
    expect(JSON.stringify(relevanceEvidenceSql)).toContain("EMPLOYER");
  });

  it("uses the canonical database eligibility predicate before proactive campaign creation", async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: "contact-1" }] })
      .mockResolvedValueOnce({ rows: [{ email: "jane@acme.example" }] })
      .mockResolvedValueOnce({ rows: [{ exists: false }] })
      .mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);

    const result = await repository.createProactiveCampaign({
      recruiterContactId: "contact-1",
      candidateProfileId: "candidate-1",
      targetRoles: ["Frontend Engineer"],
      subject: "Subject",
      body: "Body"
    });

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
