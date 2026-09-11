import { PersistentRecruiterDiscoveryService } from "./PersistentRecruiterDiscoveryService";
import { RecruiterDiscoveryProvider, RecruiterDiscoveryInput, RecruiterIdentityCandidate } from "./RecruiterDiscovery";
import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";

const input: RecruiterDiscoveryInput = {
  companyName: "Acme Corp",
  companyDomain: "acme.com",
  jobTitle: "Frontend Developer",
  jobDescription: "React role",
  candidateProfileId: "candidate-1",
  jobOpportunityId: "job-1"
};

function candidate(overrides: Partial<RecruiterIdentityCandidate> = {}): RecruiterIdentityCandidate {
  return {
    fullName: "Jane Doe",
    title: "Technical Recruiter",
    department: "recruiting",
    confidence: 92,
    verified: false,
    provider: "public-web",
    email: "recruiter@example.com",
    linkedinProfileUrl: "https://linkedin.com/in/jane-doe",
    sources: [{ url: "https://linkedin.com/in/jane-doe", type: "public_search_result", confidence: 92 }],
    ...overrides
  };
}

function setup() {
  const provider: RecruiterDiscoveryProvider = {
    name: "public-web",
    discover: jest.fn().mockResolvedValue({ provider: "public-web", discoveredAt: new Date(), contacts: [candidate(), candidate({ fullName: "John Smith", email: "john@example.com" })] }),
    discoverEmails: jest.fn().mockResolvedValue({ provider: "public-web", discoveredAt: new Date(), contacts: [] }),
    verify: jest.fn().mockResolvedValue({ verified: true, status: "VERIFIED", confidence: 95 })
  };
  const repository: RecruiterDiscoveryRepository = {
    hasRecentDiscovery: jest.fn().mockResolvedValue(false),
    startDiscoveryRun: jest.fn().mockResolvedValue({ id: "run-1", status: "RUNNING", contactsFound: 0 }),
    finishDiscoveryRun: jest.fn().mockResolvedValue(undefined),
    upsertContact: jest.fn().mockImplementation(async (_companyName, _companyDomain, contact) => ({ id: contact.email ?? contact.fullName, companyName: "Acme Corp", companyDomain: "acme.com", ...contact })),
    addSources: jest.fn().mockResolvedValue(undefined)
  } as unknown as RecruiterDiscoveryRepository;
  return { provider, repository };
}

describe("PersistentRecruiterDiscoveryService", () => {
  it("persists discovered recruiter contacts", async () => {
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

  it("keeps domain-MX verification as unverified mailbox evidence", async () => {
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
      discover: jest.fn().mockResolvedValue({ provider: "job-posting", discoveredAt: new Date(), contacts: [candidate({ provider: "job-posting", sources: [{ type: "job_posting", confidence: 100 }], verified: false })] }),
      discoverEmails: jest.fn().mockResolvedValue({ provider: "job-posting", discoveredAt: new Date(), contacts: [] }),
      verify: jest.fn()
    };
    const repository = setup().repository;
    const service = new PersistentRecruiterDiscoveryService({ provider, repository, requireVerifiedEmail: true });
    const result = await service.discoverAndPersist(input, 1);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.email).toBe("recruiter@example.com");
    expect(provider.verify).not.toHaveBeenCalled();
  });
});
