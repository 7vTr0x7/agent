import { RecruiterContactCandidate, RecruiterDiscoveryProvider } from "./RecruiterDiscovery";
import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { deduplicateRecruiterCandidates, PersistentRecruiterDiscoveryService } from "./PersistentRecruiterDiscoveryService";

function candidate(overrides: Partial<RecruiterContactCandidate> = {}): RecruiterContactCandidate {
  return {
    email: "recruiter@example.com",
    fullName: "Recruiter Example",
    title: "Technical Recruiter",
    department: "Talent Acquisition",
    seniority: "Senior",
    confidence: 90,
    verified: true,
    verificationStatus: "valid",
    provider: "public-web",
    sources: [{ url: "https://example.com/recruiter", type: "professional_profile", confidence: 90 }],
    ...overrides
  };
}

describe("deduplicateRecruiterCandidates", () => {
  it("normalizes email and keeps the strongest verified candidate", () => {
    const first = { ...candidate(), email: "Recruiter@Example.com", verified: false, confidence: 95 };
    const second = { ...candidate(), email: "recruiter@example.com", verified: true, confidence: 80 };
    const result = deduplicateRecruiterCandidates([first, second]);
    expect(result).toHaveLength(1);
    expect(result[0]?.email).toBe("recruiter@example.com");
    expect(result[0]?.verified).toBe(true);
  });
});

describe("PersistentRecruiterDiscoveryService", () => {
  const input = {
    companyName: "Example Corp",
    companyDomain: "https://www.example.com/jobs",
    jobTitle: "Senior Frontend Engineer",
    jobDescription: "React and TypeScript",
    location: "Bengaluru, India",
    candidateProfileId: "candidate-1",
    jobOpportunityId: "job-1"
  };

  function setup() {
    const provider: RecruiterDiscoveryProvider = {
      name: "public-web",
      discover: jest.fn().mockResolvedValue({
        provider: "public-web",
        discoveredAt: new Date(),
        contacts: [
          candidate({ email: "Recruiter@Example.com", confidence: 75, verified: false }),
          candidate({ email: "recruiter@example.com", confidence: 92, verified: true }),
          candidate({ email: "other@example.com", fullName: "Other Recruiter", confidence: 88 })
        ]
      }),
      verify: jest.fn(async (email: string) => ({
        email,
        verified: true,
        status: "domain_mx_verified",
        confidence: 75
      }))
    };
    const repository = {
      hasRecentDiscovery: jest.fn().mockResolvedValue(false),
      startDiscoveryRun: jest.fn().mockResolvedValue({ id: "run-1", status: "RUNNING", contactsFound: 0 }),
      upsertContact: jest.fn().mockImplementation(async (_company: string, _domain: string, contact: RecruiterContactCandidate) => ({
        id: `contact-${contact.email}`,
        companyName: "Example Corp",
        companyDomain: "example.com",
        email: contact.email,
        fullName: contact.fullName,
        title: contact.title,
        department: contact.department,
        seniority: contact.seniority,
        confidence: contact.confidence,
        verified: contact.verified,
        verificationStatus: contact.verificationStatus,
        provider: contact.provider
      })),
      addSources: jest.fn().mockResolvedValue(undefined),
      finishDiscoveryRun: jest.fn().mockResolvedValue(undefined),
      isOutreachSequenceDuplicate: jest.fn()
    } as unknown as RecruiterDiscoveryRepository;
    return { provider, repository };
  }

  it("skips permanently excluded companies before touching the provider or persistence", async () => {
    const { provider, repository } = setup();
    const service = new PersistentRecruiterDiscoveryService({ provider, repository });
    for (const companyName of ["Octopus Technologies", "Sketch Brahma Technologies"]) {
      const result = await service.discoverAndPersist({ ...input, companyName }, 3);
      expect(result.status).toBe("SKIPPED");
      expect(result.reason).toContain("permanently excluded");
    }
    expect(provider.discover).not.toHaveBeenCalled();
    expect(repository.hasRecentDiscovery).not.toHaveBeenCalled();
    expect(repository.startDiscoveryRun).not.toHaveBeenCalled();
    expect(repository.upsertContact).not.toHaveBeenCalled();
  });

  it("skips discovery during an explicitly configured provider cooldown", async () => {
    const { provider, repository } = setup();
    jest.spyOn(repository, "hasRecentDiscovery").mockResolvedValue(true);
    const service = new PersistentRecruiterDiscoveryService({ provider, repository, cooldownHours: 24 });
    const result = await service.discoverAndPersist(input, 3);
    expect(result.status).toBe("SKIPPED");
    expect(provider.discover).not.toHaveBeenCalled();
    expect(repository.startDiscoveryRun).not.toHaveBeenCalled();
  });

  it("does not use the default cooldown to block a new job opportunity", async () => {
    const { provider, repository } = setup();
    jest.spyOn(repository, "hasRecentDiscovery").mockResolvedValue(true);
    const service = new PersistentRecruiterDiscoveryService({ provider, repository });
    const result = await service.discoverAndPersist(input, 3);
    expect(result.status).toBe("DISCOVERED");
    expect(provider.discover).toHaveBeenCalledTimes(1);
  });

  it("persists unique, ranked contacts and records a successful run", async () => {
    const { provider, repository } = setup();
    const service = new PersistentRecruiterDiscoveryService({ provider, repository, cooldownHours: 24 });
    const result = await service.discoverAndPersist(input, 3);
    expect(result.status).toBe("DISCOVERED");
    expect(result.contacts).toHaveLength(2);
    expect(result.contacts[0]?.email).toBe("recruiter@example.com");
    expect(repository.upsertContact).toHaveBeenCalledTimes(2);
    expect(repository.addSources).toHaveBeenCalledTimes(2);
    expect(repository.finishDiscoveryRun).toHaveBeenCalledWith("run-1", "SUCCEEDED", 2);
  });

  it("upgrades an unverified public contact after the provider verifies its mail domain", async () => {
    const { provider, repository } = setup();
    (provider.verify as jest.Mock).mockResolvedValue({
      email: "recruiter@example.com",
      verified: true,
      status: "domain_mx_verified",
      confidence: 75
    });
    jest.spyOn(provider, "discover").mockResolvedValue({
      provider: "public-web",
      discoveredAt: new Date(),
      contacts: [candidate({ provider: "public-web", verified: false, confidence: 92 })]
    });
    const service = new PersistentRecruiterDiscoveryService({ provider, repository, requireVerifiedEmail: true });
    const result = await service.discoverAndPersist(input, 1);
    expect(provider.verify).toHaveBeenCalledWith("recruiter@example.com");
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.verified).toBe(false);
    expect(result.contacts[0]?.verificationStatus).toBe("domain_mx_verified");
  });

  it("accepts explicit recruiting emails from a job posting without third-party verification", async () => {
    const provider: RecruiterDiscoveryProvider = {
      name: "job-posting",
      discover: jest.fn().mockResolvedValue({
        provider: "job-posting",
        discoveredAt: new Date(),
        contacts: [candidate({ provider: "job-posting", verified: false, confidence: 100 })]
      }),
      verify: jest.fn()
    };
    const repository = {
      hasRecentDiscovery: jest.fn().mockResolvedValue(false),
      startDiscoveryRun: jest.fn().mockResolvedValue({ id: "run-job-posting", status: "RUNNING", contactsFound: 0 }),
      upsertContact: jest.fn().mockImplementation(async (_company: string, _domain: string, contact: RecruiterContactCandidate) => ({
        id: "contact-job-posting", companyName: "Example Corp", companyDomain: "example.com", email: contact.email,
        fullName: contact.fullName, title: contact.title, department: contact.department, seniority: contact.seniority,
        confidence: contact.confidence, verified: contact.verified, verificationStatus: contact.verificationStatus, provider: contact.provider
      })),
      addSources: jest.fn().mockResolvedValue(undefined),
      finishDiscoveryRun: jest.fn().mockResolvedValue(undefined),
      isOutreachSequenceDuplicate: jest.fn()
    } as unknown as RecruiterDiscoveryRepository;
    const service = new PersistentRecruiterDiscoveryService({ provider, repository, requireVerifiedEmail: true });
    const result = await service.discoverAndPersist(input, 1);
    expect(result.status).toBe("DISCOVERED");
    expect(result.contacts).toHaveLength(1);
  });

  it("marks the durable run failed when provider discovery throws", async () => {
    const { provider, repository } = setup();
    jest.spyOn(provider, "discover").mockRejectedValue(new Error("Provider unavailable"));
    const service = new PersistentRecruiterDiscoveryService({ provider, repository });
    await expect(service.discoverAndPersist(input, 3)).rejects.toThrow("Provider unavailable");
    expect(repository.finishDiscoveryRun).toHaveBeenCalledWith("run-1", "FAILED", 0, "Provider unavailable");
  });
});
