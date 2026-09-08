import { JobPostingRecruiterDiscoveryProvider, extractExplicitRecruiterEmails } from "./JobPostingRecruiterDiscoveryProvider";

describe("JobPostingRecruiterDiscoveryProvider", () => {
  it("extracts only same-domain emails in recruiting context", () => {
    const description = `Apply by contacting talent@Example.com. For technical questions email engineering@example.com. Recruiter: hiring@example.com. External: recruiter@gmail.com.`;
    expect(extractExplicitRecruiterEmails(description, "https://www.example.com/jobs/frontend")).toEqual(["talent@example.com", "hiring@example.com"]);
  });

  it("deduplicates addresses and ignores unrelated company emails", () => {
    const description = `Careers: talent@example.com\nRecruiting: TALENT@example.com\nSupport: support@example.com`;
    expect(extractExplicitRecruiterEmails(description, "example.com")).toEqual(["talent@example.com"]);
  });

  it("recognizes obfuscated recruiting emails and mailto links", () => {
    const description = `Recruiting: talent [at] example [dot] com. <a href="mailto:careers@example.com">Careers</a>`;
    expect(extractExplicitRecruiterEmails(description, "example.com")).toEqual(["talent@example.com", "careers@example.com"]);
  });

  it("accepts a recruiting mailbox alias even when the nearby HTML has no keyword", () => {
    const description = `<a href="mailto:jobs@example.com">Apply for this role</a>`;
    expect(extractExplicitRecruiterEmails(description, "example.com")).toEqual(["jobs@example.com"]);
  });

  it("enriches a public company email with a matching public LinkedIn profile", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("html.duckduckgo.com")) {
        return new Response('<a href="https://www.linkedin.com/in/priya-sharma">Priya Sharma - Talent Acquisition Partner | LinkedIn</a>');
      }
      return new Response('<html><body>Recruiting: priya.sharma@example.com</body></html>');
    }) as typeof fetch;

    try {
      const provider = new JobPostingRecruiterDiscoveryProvider();
      const result = await provider.discover({
        companyName: "Example",
        companyDomain: "example.com",
        jobTitle: "Frontend Engineer",
        jobDescription: "Please contact recruiting at priya.sharma@example.com.",
        candidateProfileId: "candidate-1"
      });

      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0]).toMatchObject({
        email: "priya.sharma@example.com",
        fullName: "Priya Sharma",
        title: "Talent Acquisition Partner",
        linkedinProfileUrl: "https://www.linkedin.com/in/priya-sharma"
      });
      expect(result.contacts[0]?.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "public_linkedin_search" })
      ]));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not attach an unrelated LinkedIn recruiter to an email", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("html.duckduckgo.com")) return new Response('<a href="https://www.linkedin.com/in/other-recruiter">Other Recruiter - Talent Acquisition | LinkedIn</a>');
      return new Response('<html><body>Recruiting: careers@example.com</body></html>');
    }) as typeof fetch;

    try {
      const provider = new JobPostingRecruiterDiscoveryProvider();
      const result = await provider.discover({
        companyName: "Example",
        companyDomain: "example.com",
        jobTitle: "Frontend Engineer",
        jobDescription: "Please contact careers@example.com.",
        candidateProfileId: "candidate-1"
      });
      expect(result.contacts[0]).not.toHaveProperty("linkedinProfileUrl");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("marks public posting addresses unverified", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => new Response("<html></html>")) as typeof fetch;
    try {
      const provider = new JobPostingRecruiterDiscoveryProvider();
      const result = await provider.discover({
        companyName: "Example",
        companyDomain: "example.com",
        jobTitle: "Frontend Engineer",
        jobDescription: "Please contact careers@example.com for recruiting questions.",
        candidateProfileId: "candidate-1"
      });

      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0]).toMatchObject({
        email: "careers@example.com",
        verified: false,
        confidence: 100,
        verificationStatus: "unverified_public_source"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
