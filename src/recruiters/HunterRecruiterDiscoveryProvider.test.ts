import { HunterRecruiterDiscoveryProvider, normalizeHunterCompanyDomain } from "./HunterRecruiterDiscoveryProvider";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("HunterRecruiterDiscoveryProvider", () => {
  it("normalizes employer domains without inventing a domain", () => {
    expect(normalizeHunterCompanyDomain("https://www.Example.com/jobs/123")).toBe("example.com");
    expect(normalizeHunterCompanyDomain("example.com")).toBe("example.com");
  });

  it("keeps employer-domain recruiter contacts and rejects unrelated contacts", async () => {
    const fetchImpl: typeof fetch = jest.fn().mockResolvedValue(
      response({
        data: {
          domain: "example.com",
          emails: [
            {
              value: "recruiter@example.com",
              type: "personal",
              confidence: 96,
              first_name: "Asha",
              last_name: "Shah",
              position: "Technical Recruiter",
              department: "human_resources",
              seniority: "manager",
              city: "Bengaluru",
              verification: { status: "valid" },
              sources: [{ uri: "https://example.com/team", type: "website" }]
            },
            {
              value: "engineer@example.com",
              type: "personal",
              confidence: 99,
              position: "Software Engineer",
              verification: { status: "valid" }
            },
            {
              value: "recruiter@gmail.com",
              type: "personal",
              confidence: 99,
              position: "Recruiter",
              verification: { status: "valid" }
            }
          ]
        }
      })
    );

    const provider = new HunterRecruiterDiscoveryProvider({ apiKey: "secret", fetchImpl });
    const result = await provider.discover({
      companyName: "Example",
      companyDomain: "https://www.example.com/careers",
      jobTitle: "Frontend Engineer",
      jobDescription: "React and TypeScript",
      location: "Bengaluru",
      candidateProfileId: "profile-1"
    });

    expect(result.provider).toBe("hunter");
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]).toMatchObject({
      email: "recruiter@example.com",
      fullName: "Asha Shah",
      title: "Technical Recruiter",
      verified: true,
      confidence: 96
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("verifies an email using Hunter's verifier endpoint", async () => {
    const fetchImpl: typeof fetch = jest.fn().mockResolvedValue(
      response({ data: { status: "valid", score: 100 } })
    );

    const provider = new HunterRecruiterDiscoveryProvider({ apiKey: "secret", fetchImpl });
    const result = await provider.verify("Recruiter@Example.com");

    expect(result).toEqual({
      email: "recruiter@example.com",
      verified: true,
      status: "valid",
      confidence: 100
    });

    const calledUrl = String((fetchImpl as jest.Mock).mock.calls[0]?.[0]);
    expect(calledUrl).toContain("/email-verifier");
    expect(calledUrl).toContain("email=recruiter%40example.com");
    expect(calledUrl).toContain("api_key=secret");
  });

  it("fails closed on Hunter API errors", async () => {
    const fetchImpl: typeof fetch = jest.fn().mockResolvedValue(response({ errors: [] }, 429));
    const provider = new HunterRecruiterDiscoveryProvider({ apiKey: "secret", fetchImpl });

    await expect(
      provider.discover({
        companyName: "Example",
        companyDomain: "example.com",
        jobTitle: "Frontend Engineer",
        jobDescription: "React",
        candidateProfileId: "profile-1"
      })
    ).rejects.toThrow("HTTP 429");
  });

  it("does not verify malformed addresses against the provider", async () => {
    const fetchImpl: typeof fetch = jest.fn();
    const provider = new HunterRecruiterDiscoveryProvider({ apiKey: "secret", fetchImpl });

    await expect(provider.verify("not-an-email")).resolves.toEqual({
      email: "not-an-email",
      verified: false,
      status: "invalid",
      confidence: 0
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
