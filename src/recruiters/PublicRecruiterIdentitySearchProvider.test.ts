import { PublicRecruiterIdentitySearchProvider } from "./PublicRecruiterIdentitySearchProvider";

describe("PublicRecruiterIdentitySearchProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("rejects slug-only LinkedIn identities without a plausible full name", async () => {
    const html = `
      <a href="https://www.linkedin.com/in/john-doe-12345">john-doe-12345</a>
      Technical Recruiter at Acme Corp
    `;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => html
    }) as unknown as typeof fetch;

    const provider = new PublicRecruiterIdentitySearchProvider();
    const result = await provider.discover({
      companyName: "Acme Corp",
      companyDomain: "acme.com",
      jobTitle: "Frontend Developer",
      jobDescription: "React role",
      candidateProfileId: "candidate-1",
      jobOpportunityId: null
    });

    expect(result).toHaveLength(0);
  });
});
