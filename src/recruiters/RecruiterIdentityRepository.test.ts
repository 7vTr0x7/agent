import { RecruiterIdentityRepository } from "./RecruiterIdentityRepository";
import { RecruiterIdentityCandidate } from "./RecruiterDiscovery";

function storedRow() {
  return {
    id: "contact-1",
    company_name: "Example Corp",
    company_domain: "example.com",
    email: "careers@example.com",
    full_name: null,
    title: "Recruiting contact",
    department: "recruiting",
    seniority: null,
    country: null,
    location: null,
    confidence: 100,
    verified: false,
    verification_status: "unverified_public_source",
    provider: "public-web",
    linkedin_profile_url: null,
    email_discovery_status: "FOUND",
    email_status: "UNVERIFIED",
    domain_status: "VALID",
    mx_status: "UNKNOWN",
    mailbox_evidence: false,
    verification_evidence: [],
    discovery_source: "public-web",
    suppressed: false,
    suppression_reason: null,
    last_contacted_at: null,
    email_discovery_attempted_at: null,
    updated_at: new Date()
  };
}

const candidate: RecruiterIdentityCandidate = {
  email: "careers@example.com",
  title: "Recruiting contact",
  department: "recruiting",
  confidence: 100,
  verified: false,
  verificationStatus: "unverified_public_source",
  provider: "public-web",
  sources: [{ type: "job_posting", confidence: 100 }]
};

describe("RecruiterIdentityRepository", () => {
  it("uses an atomic typed identity-key upsert instead of an ambiguous nullable-parameter conflict lookup", async () => {
    const row = storedRow();
    const database = {
      query: jest.fn().mockResolvedValue({ rows: [row] })
    };

    const repository = new RecruiterIdentityRepository(database as never);
    const first = await repository.upsertIdentity("Example Corp", "example.com", candidate);
    const second = await repository.upsertIdentity("Example Corp", "example.com", candidate);

    expect(first.id).toBe("contact-1");
    expect(second.id).toBe("contact-1");
    expect(database.query).toHaveBeenCalledTimes(2);

    const sql = database.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("ON CONFLICT (company_domain, identity_key) DO UPDATE SET");
    expect(sql).toContain("RETURNING id,company_name,company_domain");
    expect(sql).not.toContain("IS NOT NULL AND LOWER(linkedin_profile_url)");
  });
});
