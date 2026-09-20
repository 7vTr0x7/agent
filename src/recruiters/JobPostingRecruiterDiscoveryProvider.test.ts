import { JobPostingRecruiterDiscoveryProvider, extractExplicitRecruiterEmails } from "./JobPostingRecruiterDiscoveryProvider";

describe("JobPostingRecruiterDiscoveryProvider", () => {
  it("rejects generic recruiting mailboxes because they do not identify a real recruiter", () => {
    const description = `Apply by contacting talent@Example.com. For technical questions email engineering@example.com. Recruiter: hiring@example.com. External: recruiter@gmail.com.`;
    expect(extractExplicitRecruiterEmails(description, "https://www.example.com/jobs/frontend")).toEqual([]);
  });

  it("ignores generic recruiting aliases and unrelated company emails", () => {
    const description = `Careers: talent@example.com\nRecruiting: TALENT@example.com\nSupport: support@example.com`;
    expect(extractExplicitRecruiterEmails(description, "example.com")).toEqual([]);
  });

  it("rejects obfuscated generic recruiting mailboxes and generic mailto aliases", () => {
    const description = `Recruiting: talent [at] example [dot] com. <a href="mailto:careers@example.com">Careers</a>`;
    expect(extractExplicitRecruiterEmails(description, "example.com")).toEqual([]);
  });

  it("does not treat a recruiting mailbox alias as a named recruiter", () => {
    const description = `<a href="mailto:jobs@example.com">Apply for this role</a>`;
    expect(extractExplicitRecruiterEmails(description, "example.com")).toEqual([]);
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

  it("falls back to the bounded public reader when a search provider blocks direct access", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://r.jina.ai/https://html.duckduckgo.com")) return new Response('<a href="https://www.linkedin.com/in/priya-sharma">Priya Sharma - Talent Acquisition Partner | Example | LinkedIn</a>');
      if (url.includes("html.duckduckgo.com")) return new Response("", { status: 429 });
      return new Response("<html><body>Example recruiting</body></html>");
    }) as typeof fetch;
    try {
      const provider = new JobPostingRecruiterDiscoveryProvider();
      const result = await provider.discover({ companyName: "Example", companyDomain: "example.com", jobTitle: "Frontend Engineer", jobDescription: "Current hiring for the frontend engineering team.", candidateProfileId: "candidate-1" });
      expect(result.contacts).toEqual(expect.arrayContaining([expect.objectContaining({ fullName: "Priya Sharma", linkedinProfileUrl: "https://www.linkedin.com/in/priya-sharma" })]));
    } finally { globalThis.fetch = originalFetch; }
  });

  it("uses the public-reader representation when direct search returns successful non-profile results", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://r.jina.ai/https://www.bing.com/search")) {
        return new Response("### Results\\n[Kayley LoSardo — Talent Advisor | Fieldguide](https://www.linkedin.com/in/kayleylosardo)\\nFieldguide recruiting and talent acquisition");
      }
      if (url.includes("html.duckduckgo.com") || url.includes("google.com/search")) {
        return new Response("<html><body>search results without recruiter profiles</body></html>");
      }
      return new Response("<html><body>search results without recruiter profiles</body></html>");
    }) as typeof fetch;
    try {
      const provider = new JobPostingRecruiterDiscoveryProvider();
      const result = await provider.discover({
        companyName: "Fieldguide",
        companyDomain: "fieldguide.io",
        jobTitle: "Software Engineer",
        jobDescription: "Current hiring for software engineering.",
        candidateProfileId: "candidate-1"
      });
      expect(result.contacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          fullName: "Kayley LoSardo",
          title: "Talent Advisor",
          linkedinProfileUrl: "https://www.linkedin.com/in/kayleylosardo"
        })
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
      expect(result.contacts).toHaveLength(0);
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

      expect(result.contacts).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects search-provider source labels parsed as recruiter names", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("html.duckduckgo.com")) {
        return new Response('<a href="https://www.linkedin.com/in/fake-profile">Startpage Search Results URL Source - Recruiter | LinkedIn</a>');
      }
      return new Response("<html><body>Example recruiting</body></html>");
    }) as typeof fetch;

    try {
      const provider = new JobPostingRecruiterDiscoveryProvider();
      const result = await provider.discover({
        companyName: "Example",
        companyDomain: "example.com",
        jobTitle: "Frontend Engineer",
        jobDescription: "Current hiring for frontend engineering.",
        candidateProfileId: "candidate-1"
      });
      expect(result.contacts).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("discovers a named recruiter profile without inventing an email", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("html.duckduckgo.com")) {
        return new Response('<a href="https://www.linkedin.com/in/priya-sharma">Priya Sharma - Talent Acquisition Partner | Legion Technologies | LinkedIn</a>');
      }
      return new Response("<html><body>Legion Technologies</body></html>");
    }) as typeof fetch;

    try {
      const provider = new JobPostingRecruiterDiscoveryProvider();
      const result = await provider.discover({
        companyName: "Legion Technologies",
        companyDomain: "legion.co",
        jobTitle: "Frontend Engineer",
        jobDescription: "Current hiring for the frontend engineering team.",
        candidateProfileId: "candidate-1"
      });

      expect(result.contacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          fullName: "Priya Sharma",
          title: "Talent Acquisition Partner",
          linkedinProfileUrl: "https://www.linkedin.com/in/priya-sharma"
        })
      ]));
      const profile = result.contacts.find((contact) => contact.fullName === "Priya Sharma");
      expect(profile?.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "public_linkedin_search" }),
        expect.objectContaining({ type: "job_posting" })
      ]));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
