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
  it("casts nullable dedupe parameters so PostgreSQL can infer their types after an insert conflict", async () => {
    const row = storedRow();
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: "contact-1" }] })
        .mockResolvedValueOnce({ rows: [row] })
    };

    const repository = new RecruiterIdentityRepository(database as never);
    const first = await repository.upsertIdentity("Example Corp", "example.com", candidate);
    expect(first.id).toBe("contact-1");

    const second = await repository.upsertIdentity("Example Corp", "example.com", candidate);
    expect(second.id).toBe("contact-1");

    const conflictLookupSql = database.query.mock.calls[2]?.[0] as string;
    expect(conflictLookupSql).toContain("$2::text IS NOT NULL");
    expect(conflictLookupSql).toContain("$3::text IS NOT NULL");
    expect(conflictLookupSql).toContain("$4::text IS NOT NULL");
    expect(conflictLookupSql).toContain("LOWER($2::text)");
    expect(conflictLookupSql).toContain("LOWER($3::text)");
    expect(conflictLookupSql).toContain("LOWER($4::text)");
  });
});
