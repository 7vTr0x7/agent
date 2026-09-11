import { SnovRecruiterDiscoveryProvider, normalizeSnovStatus } from "./SnovRecruiterDiscoveryProvider";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("SnovRecruiterDiscoveryProvider", () => {
  it("maps Snov smtp_status=valid to canonical mailbox verification", async () => {
    const fetchImpl: typeof fetch = jest.fn()
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ data: { task_hash: "prospect-task" } }))
      .mockResolvedValueOnce(response({ data: [{ first_name: "Asha", last_name: "Shah", position: "Technical Recruiter", source_page: "https://www.linkedin.com/in/asha-shah", search_emails_start: "https://api.snov.io/v2/domain-search/prospects/search-emails/start/prospect-hash" }], status: "completed" }))
      .mockResolvedValueOnce(response({ data: { task_hash: "email-task" } }))
      .mockResolvedValueOnce(response({ data: [{ email: "asha@example.com", smtp_status: "valid" }], status: "completed" }));
    const provider = new SnovRecruiterDiscoveryProvider({ clientId: "id", clientSecret: "secret", fetchImpl, pollDelayMs: 0 });
    const result = await provider.discover({ companyName: "Example", companyDomain: "example.com", jobTitle: "Frontend Engineer", jobDescription: "React", candidateProfileId: "candidate-1" });
    expect(result.contacts[0]).toMatchObject({ email: "asha@example.com", fullName: "Asha Shah", verified: true, verificationStatus: "mailbox_verified", confidence: 95, verificationEvidence: [{ provider: "snov", status: "mailbox_verified", mailboxLevel: true, source: "snov_prospect_email_verification" }] });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("reuses a cached access token and returns canonical verification status with mailbox evidence", async () => {
    const fetchImpl: typeof fetch = jest.fn()
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ data: { task_hash: "verify-task" } }))
      .mockResolvedValueOnce(response({ data: [{ email: "recruiter@example.com", status: "valid", score: 98 }], status: "completed" }));
    const provider = new SnovRecruiterDiscoveryProvider({ clientId: "id", clientSecret: "secret", fetchImpl, pollDelayMs: 0 });
    const result = await provider.verify("recruiter@example.com");
    expect(result).toMatchObject({ email: "recruiter@example.com", verified: true, status: "mailbox_verified", confidence: 98 });
    expect(result.verificationEvidence).toEqual([{
      provider: "snov",
      status: "mailbox_verified",
      confidence: 98,
      mailboxLevel: true,
      source: "snov_email_verification"
    }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not treat unverifiable Snov results as mailbox verification", () => {
    expect(normalizeSnovStatus("unknown")).toEqual({ verified: false, verificationStatus: "unknown" });
    expect(normalizeSnovStatus("not_valid")).toEqual({ verified: false, verificationStatus: "INVALID" });
    expect(normalizeSnovStatus("valid")).toEqual({ verified: true, verificationStatus: "mailbox_verified" });
  });
});
