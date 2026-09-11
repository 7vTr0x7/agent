import { PublicRecruiterIdentitySearchProvider } from "./PublicRecruiterIdentitySearchProvider";

describe("PublicRecruiterIdentitySearchProvider", () => {
  it("rejects a LinkedIn slug when no independently parsed full name is present", async () => {
    const provider = new PublicRecruiterIdentitySearchProvider();
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => new Response(
      "LinkedIn Recruiter profile https://linkedin.com/in/jane-doe recruiter React frontend engineer",
      { status: 200 }
    )) as typeof fetch;
    try {
      const results = await provider.discover({
        companyName: "Acme Corp",
        companyDomain: "acme.com",
        jobTitle: "Frontend Engineer",
        jobDescription: "React and TypeScript",
        candidateProfileId: "candidate-1"
      });
      expect(results).toEqual([]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("accepts a public recruiter name only when the evidence contains a plausible full name", async () => {
    const provider = new PublicRecruiterIdentitySearchProvider();
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => new Response(
      "Jane Doe - Technical Recruiter at Acme Corp https://linkedin.com/in/jane-doe hiring React frontend engineers",
      { status: 200 }
    )) as typeof fetch;
    try {
      const results = await provider.discover({
        companyName: "Acme Corp",
        companyDomain: "acme.com",
        jobTitle: "Frontend Engineer",
        jobDescription: "React and TypeScript",
        candidateProfileId: "candidate-1"
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.fullName).toBe("Jane Doe");
      expect(results[0]?.linkedinProfileUrl).toBe("https://linkedin.com/in/jane-doe");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
