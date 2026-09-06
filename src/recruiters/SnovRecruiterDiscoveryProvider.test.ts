import { SnovRecruiterDiscoveryProvider } from "./SnovRecruiterDiscoveryProvider";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("SnovRecruiterDiscoveryProvider", () => {
  it("discovers and verifies recruiter emails without requiring the candidate to have a company-domain mailbox", async () => {
    const fetchImpl: typeof fetch = jest.fn()
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ data: { task_hash: "prospect-task" } }))
      .mockResolvedValueOnce(response({
        data: [{
          first_name: "Asha",
          last_name: "Shah",
          position: "Technical Recruiter",
          source_page: "https://www.linkedin.com/in/asha-shah",
          search_emails_start: "https://api.snov.io/v2/domain-search/prospects/search-emails/start/prospect-hash"
        }],
        status: "completed"
      }))
      .mockResolvedValueOnce(response({ data: { task_hash: "email-task" } }))
      .mockResolvedValueOnce(response({ data: [{ email: "asha@example.com", smtp_status: "valid" }], status: "completed" }));

    const provider = new SnovRecruiterDiscoveryProvider({ clientId: "id", clientSecret: "secret", fetchImpl, pollDelayMs: 0 });
    const result = await provider.discover({
      companyName: "Example",
      companyDomain: "example.com",
      jobTitle: "Frontend Engineer",
      jobDescription: "React",
      candidateProfileId: "candidate-1"
    });

    expect(result.contacts[0]).toMatchObject({ email: "asha@example.com", fullName: "Asha Shah", verified: true, confidence: 95 });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("reuses a cached access token for verification", async () => {
    const fetchImpl: typeof fetch = jest.fn()
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ data: { task_hash: "verify-task" } }))
      .mockResolvedValueOnce(response({ data: [{ email: "recruiter@example.com", status: "valid", score: 98 }], status: "completed" }));

    const provider = new SnovRecruiterDiscoveryProvider({ clientId: "id", clientSecret: "secret", fetchImpl, pollDelayMs: 0 });
    await expect(provider.verify("recruiter@example.com")).resolves.toEqual({
      email: "recruiter@example.com",
      verified: true,
      status: "valid",
      confidence: 98
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
