import { PersistentRecruiterDiscoveryService } from "./PersistentRecruiterDiscoveryService";
import { RecruiterDiscoveryProvider, RecruiterDiscoveryInput, RecruiterIdentityCandidate } from "./RecruiterDiscovery";
import { RecruiterIdentityRepository, StoredRecruiterIdentity } from "./RecruiterIdentityRepository";
import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";

const input: RecruiterDiscoveryInput = {
  companyName: "Acme Corp",
  companyDomain: "acme.com",
  jobTitle: "Frontend Developer",
  jobDescription: "React role",
  candidateProfileId: "candidate-1",
  jobOpportunityId: "job-1"
};

function stored(overrides: Partial<StoredRecruiterIdentity> = {}): StoredRecruiterIdentity {
  return {
    id: "recruiter-1",
    companyName: "Acme Corp",
    companyDomain: "acme.com",
    email: null,
    fullName: "Jane Doe",
    title: "Technical Recruiter",
    department: "recruiting",
    confidence: 95,
    verified: false,
    verificationStatus: "identity_public_source",
    provider: "public-web",
    linkedinProfileUrl: "https://linkedin.com/in/jane-doe",
    emailDiscoveryStatus: "PENDING",
    ...overrides
  };
}

function baseRepository(): RecruiterDiscoveryRepository {
  return {
    hasRecentDiscovery: jest.fn().mockResolvedValue(false),
    startDiscoveryRun: jest.fn().mockResolvedValue({ id: "run-1", status: "RUNNING", contactsFound: 0 }),
    finishDiscoveryRun: jest.fn().mockResolvedValue(undefined)
  } as unknown as RecruiterDiscoveryRepository;
}

function identityRepository(initial = stored()): RecruiterIdentityRepository & { state: StoredRecruiterIdentity } {
  const state = initial;
  return {
    state,
    upsertIdentity: jest.fn(async () => state),
    addSources: jest.fn().mockResolvedValue(undefined),
    markEmailDiscovery: jest.fn(async (_id: string, status: StoredRecruiterIdentity["emailDiscoveryStatus"]) => { state.emailDiscoveryStatus = status; }),
    enrichEmail: jest.fn(async (_id: string, email: string, verified: boolean, verificationStatus?: string, confidence?: number) => {
      state.email = email;
      state.verified = verified;
      state.verificationStatus = verificationStatus;
      state.emailStatus = verificationStatus === "LIKELY" ? "LIKELY" : verified ? "VERIFIED" : "UNVERIFIED";
      state.confidence = Math.max(state.confidence ?? 0, confidence ?? 0);
      state.emailDiscoveryStatus = "FOUND";
      return state;
    })
  } as unknown as RecruiterIdentityRepository & { state: StoredRecruiterIdentity };
}

function provider(
  discovered: RecruiterIdentityCandidate[],
  emails: RecruiterIdentityCandidate[] = [],
  verification: { verified: boolean; status: string; confidence: number } = { verified: false, status: "LIKELY", confidence: 75 }
): RecruiterDiscoveryProvider {
  return {
    name: "public-web",
    discover: jest.fn().mockResolvedValue({ provider: "public-web", contacts: discovered, discoveredAt: new Date() }),
    discoverEmails: jest.fn().mockResolvedValue({ provider: "public-web", contacts: emails, discoveredAt: new Date() }),
    verify: jest.fn().mockResolvedValue(verification)
  };
}

describe("recruiter identity/email pipeline", () => {
  it("persists a recruiter profile without an email and retains EMAIL_NOT_FOUND", async () => {
    const repo = baseRepository();
    const identities = identityRepository();
    const service = new PersistentRecruiterDiscoveryService({ repository: repo, identityRepository: identities, provider: provider([{
      fullName: "Jane Doe",
      title: "Technical Recruiter",
      department: "recruiting",
      confidence: 95,
      verified: false,
      provider: "public-web",
      linkedinProfileUrl: "https://linkedin.com/in/jane-doe",
      sources: [{ url: "https://linkedin.com/in/jane-doe", type: "public_linkedin_search", confidence: 95 }]
    }]) });

    const result = await service.discoverAndPersist(input, 5);

    expect(result.status).toBe("DISCOVERED");
    expect(result.metrics.recruiterDiscovery.profileOnly).toBe(1);
    expect(result.metrics.emailDiscovery.notFound).toBe(1);
    expect(identities.markEmailDiscovery).toHaveBeenCalledWith("recruiter-1", "NOT_FOUND");
    expect(result.contacts).toHaveLength(0);
  });

  it("enriches the same recruiter identity when a later verified email is found", async () => {
    const repo = baseRepository();
    const identities = identityRepository();
    const email: RecruiterIdentityCandidate = {
      email: "jane@acme.com",
      fullName: "Jane Doe",
      title: "Technical Recruiter",
      confidence: 96,
      verified: true,
      verificationStatus: "VERIFIED",
      provider: "public-web",
      linkedinProfileUrl: "https://linkedin.com/in/jane-doe",
      sources: [{ url: "https://linkedin.com/in/jane-doe", type: "public_search_result", confidence: 96 }]
    };
    const service = new PersistentRecruiterDiscoveryService({ repository: repo, identityRepository: identities, provider: provider([{
      fullName: "Jane Doe",
      title: "Technical Recruiter",
      confidence: 95,
      verified: false,
      provider: "public-web",
      linkedinProfileUrl: "https://linkedin.com/in/jane-doe",
      sources: [{ url: "https://linkedin.com/in/jane-doe", type: "public_linkedin_search", confidence: 95 }]
    }], [email], { verified: true, status: "VERIFIED", confidence: 96 }) });

    const result = await service.discoverAndPersist(input, 5);

    expect(identities.enrichEmail).toHaveBeenCalledWith("recruiter-1", "jane@acme.com", true, "VERIFIED", 96);
    expect(result.metrics.emailDiscovery.found).toBe(1);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.email).toBe("jane@acme.com");
  });

  it("preserves MX/domain-only evidence as LIKELY and never makes it outreach eligible", async () => {
    const repo = baseRepository();
    const identities = identityRepository();
    const email: RecruiterIdentityCandidate = {
      email: "jane@acme.com",
      fullName: "Jane Doe",
      title: "Technical Recruiter",
      confidence: 96,
      verified: false,
      provider: "public-web",
      linkedinProfileUrl: "https://linkedin.com/in/jane-doe",
      sources: [{ type: "public_search_result", confidence: 96 }]
    };
    const service = new PersistentRecruiterDiscoveryService({ repository: repo, identityRepository: identities, provider: provider([{
      fullName: "Jane Doe",
      title: "Technical Recruiter",
      confidence: 95,
      verified: false,
      provider: "public-web",
      linkedinProfileUrl: "https://linkedin.com/in/jane-doe",
      sources: [{ type: "public_linkedin_search", confidence: 95 }]
    }], [email], { verified: true, status: "domain_mx_verified", confidence: 75 }) });

    const result = await service.discoverAndPersist(input, 5);

    expect(identities.enrichEmail).toHaveBeenCalledWith("recruiter-1", "jane@acme.com", false, "domain_mx_verified", 96);
    expect(identities.markEmailDiscovery).not.toHaveBeenCalledWith("recruiter-1", "INVALID");
    expect(result.metrics.emailDiscovery.found).toBe(1);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.verified).toBe(false);
    expect(result.contacts[0]?.verificationStatus).toBe("domain_mx_verified");
    expect(identities.state.verified).toBe(false);
    expect(identities.state.emailStatus).toBe("LIKELY");
  });

  it("retains the recruiter when an email is invalid and never makes it outreach eligible", async () => {
    const repo = baseRepository();
    const identities = identityRepository();
    const service = new PersistentRecruiterDiscoveryService({ repository: repo, identityRepository: identities, provider: provider([{
      fullName: "Jane Doe",
      title: "Technical Recruiter",
      confidence: 95,
      verified: false,
      provider: "public-web",
      linkedinProfileUrl: "https://linkedin.com/in/jane-doe",
      sources: [{ type: "public_linkedin_search", confidence: 95 }]
    }], [{
      email: "jane@gmail.com",
      fullName: "Jane Doe",
      title: "Technical Recruiter",
      confidence: 99,
      verified: true,
      verificationStatus: "VERIFIED",
      provider: "public-web",
      linkedinProfileUrl: "https://linkedin.com/in/jane-doe",
      sources: [{ type: "public_search_result", confidence: 99 }]
    }]) });

    const result = await service.discoverAndPersist(input, 5);

    expect(identities.markEmailDiscovery).toHaveBeenCalledWith("recruiter-1", "INVALID");
    expect(result.metrics.emailDiscovery.invalid).toBe(1);
    expect(result.contacts).toHaveLength(0);
  });
});
