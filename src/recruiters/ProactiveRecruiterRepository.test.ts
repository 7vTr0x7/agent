import { ProactiveRecruiterRepository, isEmployerEmailDomainConsistent } from "./ProactiveRecruiterRepository";
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
  it("rejects permanently excluded employers before persistence", async () => {
    const database = { query: jest.fn() };
    const repository = new ProactiveRecruiterRepository(database as never);

    const result = await repository.persistCandidate("candidate-excluded", hiringPostCandidate({
      employer: "Octopus Technologies",
      employerDomain: "octopus.example"
    }));

    expect(result).toBeNull();
    expect(database.query).not.toHaveBeenCalled();
  });

  it("rejects blocked job-board and ATS domains before persistence", async () => {
    const database = { query: jest.fn() };
    const repository = new ProactiveRecruiterRepository(database as never);

    const result = await repository.persistCandidate("candidate-ats", hiringPostCandidate({
      employer: "Workable",
      employerDomain: "workable.com"
    }));

    expect(result).toBeNull();
    expect(database.query).not.toHaveBeenCalled();
  });

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
    const insertCall = database.query.mock.calls.find((call: unknown[]) => String(call[0]).includes("INSERT INTO recruiter_contacts"));
    const insertParams = insertCall?.[1] as unknown[];
    expect(String(insertParams?.[14])).toContain("https://www.linkedin.com/posts/");
    expect(String(insertParams?.[15])).toContain("profile:");
    const sourceCall = database.query.mock.calls.find((call: unknown[]) => String(call[0]).includes("INSERT INTO recruiter_contact_sources"));
    const sourceParams = sourceCall?.[1] as unknown[];
    expect(sourceParams?.[2]).toBe("job_hiring_evidence");
  });

  it("persists a legitimate recruiter using a generic mailbox without treating the mailbox provider as an employer-domain mismatch", async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: "canonical-contact-generic-mailbox" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "contact-generic-mailbox" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    const repository = new ProactiveRecruiterRepository(database as never);

    const result = await repository.persistCandidate("candidate-generic-mailbox", hiringPostCandidate({
      email: "jane.recruiter@gmail.com",
      emailStatus: "UNVERIFIED",
      employerDomain: "acme.example"
    }));

    expect(result).toBe("contact-generic-mailbox");
    expect(database.query).toHaveBeenCalledTimes(6);
    const contactInsertCall = database.query.mock.calls.find((call: unknown[]) => String(call[0]).includes("INSERT INTO contacts "));
    const contactInsertParams = contactInsertCall?.[1] as unknown[];
    expect(contactInsertParams?.[2]).toBe("jane.recruiter@gmail.com");
    const insertCall = database.query.mock.calls.find((call: unknown[]) => String(call[0]).includes("INSERT INTO recruiter_contacts"));
    const insertParams = insertCall?.[1] as unknown[];
    expect(insertParams?.[5]).toBe(false);
    expect(insertParams?.[6]).toBe("public-web-unverified");
  });

  it("accepts generic mailbox providers but rejects a non-generic employer-domain contradiction", () => {
    expect(isEmployerEmailDomainConsistent("gmail.com", "acme.example")).toBe(true);
    expect(isEmployerEmailDomainConsistent("outlook.com", "acme.example")).toBe(true);
    expect(isEmployerEmailDomainConsistent("recruiter@othercorp.example", "acme.example")).toBe(false);
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
