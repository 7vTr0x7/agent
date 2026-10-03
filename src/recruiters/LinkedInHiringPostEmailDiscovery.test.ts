import { LinkedInHiringPostEmailDiscovery } from "./LinkedInHiringPostEmailDiscovery";

describe("LinkedInHiringPostEmailDiscovery", () => {
  it("extracts a relevant LinkedIn hiring post email", async () => {
    const postUrl = "https://www.linkedin.com/posts/example-recruiter_hiring-frontend-react-activity-123456789";
    const searchPage = [
      postUrl,
      "Example Recruiter",
      "🚀 Hiring: Frontend Engineer | Pune",
      "Experience: 3+ Years",
      "Location: Pune",
      "React.js Next.js TypeScript JavaScript Redux REST APIs",
      "We are hiring a Frontend Engineer.",
      "Please share your updated CV at vinay.sharma@codersbrain.com"
    ].join("\n");

    const provider = new LinkedInHiringPostEmailDiscovery();
    const result = await provider.discover({
      targetRoles: ["Frontend Developer", "React Developer"],
      skills: ["React", "Next.js", "TypeScript", "JavaScript"],
      yearsExperience: 3,
      preferredLocations: ["Bengaluru", "Pune", "India", "Remote"],
      maxQueries: 1,
      fetchText: async (url) => url === postUrl ? searchPage : searchPage
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      employer: "Codersbrain",
      employerDomain: "codersbrain.com",
      email: "vinay.sharma@codersbrain.com",
      emailStatus: "UNVERIFIED",
      discoveryUrl: postUrl,
      contactType: "EMPLOYER"
    });
    expect(result.metrics.relevantPosts).toBeGreaterThan(0);
    expect(result.metrics.directEmails).toBe(1);
  });


  it("extracts LinkedIn posts from escaped and search-engine redirect URLs", async () => {
    const postUrl = "https://www.linkedin.com/posts/example-recruiter_hiring-react-activity-111222333";
    const encodedPost = encodeURIComponent(postUrl);
    const searchPage = [
      `https://www.google.com/url?q=${encodedPost}`,
      `<a href="https://www.google.com/url?url=${encodedPost}">LinkedIn result</a>`,
      postUrl.replace(/https:\/\//, "https:\\/\\/"),
      "Hiring: React Developer | Bengaluru",
      "Experience: 3+ Years",
      "Location: Bengaluru, India",
      "React Next.js TypeScript JavaScript",
      "Please send your resume to hiring@redirect-example.com"
    ].join("\n");

    const provider = new LinkedInHiringPostEmailDiscovery();
    const result = await provider.discover({
      targetRoles: ["Frontend Developer", "React Developer"],
      skills: ["React", "Next.js", "TypeScript"],
      yearsExperience: 3,
      preferredLocations: ["Bengaluru", "Pune", "India", "Remote"],
      maxQueries: 1,
      fetchText: async () => searchPage
    });

    expect(result.metrics.postUrlsFound).toBe(1);
    expect(result.metrics.directEmails).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      discoveryUrl: postUrl,
      email: "hiring@redirect-example.com"
    });
  });



  it("normalizes Markdown-wrapped LinkedIn post URLs", async () => {
    const postUrl = "https://www.linkedin.com/posts/example-recruiter_hiring-react-activity-333444555";
    const markdown = `[${postUrl}](${postUrl})`;
    const page = [
      markdown,
      "Hiring: React Developer | Bengaluru",
      "Experience: 3+ Years",
      "Location: Bengaluru, India",
      "React Next.js TypeScript",
      "Send your resume to hiring@company-example.com"
    ].join("\n");

    const provider = new LinkedInHiringPostEmailDiscovery();
    const result = await provider.discover({
      targetRoles: ["React Developer"],
      skills: ["React", "Next.js", "TypeScript"],
      yearsExperience: 3,
      preferredLocations: ["Bengaluru", "India"],
      maxQueries: 1,
      fetchText: async () => page
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.discoveryUrl).toBe(postUrl);
    expect(result.candidates[0]?.employer).toBe("Company Example");
  });

  it("continues when a public search provider throws", async () => {
    const provider = new LinkedInHiringPostEmailDiscovery();
    const result = await provider.discover({
      targetRoles: ["React Developer"],
      skills: ["React"],
      yearsExperience: 3,
      preferredLocations: ["Bengaluru", "India"],
      maxQueries: 1,
      fetchText: async () => {
        throw new Error("simulated provider failure");
      }
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.metrics.rejected).toBeGreaterThan(0);
  });

  it("does not treat generic mailbox domains as employer identities", async () => {
    const postUrl = "https://www.linkedin.com/posts/example-recruiter_hiring-react-activity-444555666";
    const page = [
      postUrl,
      "Hiring: React Developer | Bengaluru",
      "Experience: 3+ Years",
      "Location: Bengaluru, India",
      "React Next.js TypeScript",
      "Send your resume to example.recruiter@gmail.com"
    ].join("\n");

    const provider = new LinkedInHiringPostEmailDiscovery();
    const result = await provider.discover({
      targetRoles: ["React Developer"],
      skills: ["React", "Next.js", "TypeScript"],
      yearsExperience: 3,
      preferredLocations: ["Bengaluru", "India"],
      maxQueries: 1,
      fetchText: async () => page
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.metrics.rejected).toBeGreaterThan(0);
  });

  it("falls back to a post-specific search when the post URL is found without its email in the first result", async () => {
    const postUrl = "https://www.linkedin.com/posts/example-recruiter_hiring-react-developer-activity-222333444";
    const previousProviders = process.env.PROACTIVE_RECRUITER_SEARCH_PROVIDERS;
    process.env.PROACTIVE_RECRUITER_SEARCH_PROVIDERS = "google-direct";
    let calls = 0;
    try {
      const provider = new LinkedInHiringPostEmailDiscovery();
      const result = await provider.discover({
        targetRoles: ["React Developer"],
        skills: ["React", "Next.js"],
        yearsExperience: 3,
        preferredLocations: ["Bengaluru", "India"],
        maxQueries: 1,
        fetchText: async (url) => {
          calls += 1;
          if (url === postUrl) return "We are hiring a React Developer in Bengaluru. Send your resume to the recruiter.";
          if (calls === 1) return `Search result: ${postUrl}`;
          return `Search result: ${postUrl} — React Developer — send your resume to recruiter@company-example.com`;
        }
      });
      expect(result.metrics.postUrlsFound).toBe(1);
      expect(result.metrics.directEmails).toBe(1);
      expect(result.candidates[0]?.email).toBe("recruiter@company-example.com");
    } finally {
      if (previousProviders === undefined) delete process.env.PROACTIVE_RECRUITER_SEARCH_PROVIDERS;
      else process.env.PROACTIVE_RECRUITER_SEARCH_PROVIDERS = previousProviders;
    }
  });

  it("uses a reader fallback when the direct LinkedIn post is an authwall", async () => {
    const postUrl = "https://www.linkedin.com/posts/example-recruiter_hiring-react-activity-555666777";
    const readerUrl = `https://r.jina.ai/${postUrl}`;
    const calls: string[] = [];
    const search = `${postUrl} Example Recruiter hiring React Bengaluru`;
    const post = "Example Recruiter | Technical Recruiter at Acme Corp | We're hiring React developers in Bengaluru. Send your resume to hiring@acme-example.com.";
    const provider = new LinkedInHiringPostEmailDiscovery();
    const result = await provider.discover({
      targetRoles: ["React Developer"],
      skills: ["React", "TypeScript"],
      yearsExperience: 3,
      preferredLocations: ["Bengaluru", "India"],
      maxQueries: 1,
      fetchText: async (url) => {
        calls.push(url);
        if (url === postUrl) return "Sign Up | LinkedIn Agree & Join LinkedIn";
        if (url === readerUrl) return post;
        return search;
      }
    });
    expect(calls).toContain(readerUrl);
    expect(result.metrics.directEmails).toBe(1);
    expect(result.candidates[0]?.email).toBe("hiring@acme-example.com");
  });

  it("extracts an employer-domain email when the hiring instruction is far from the mailbox", async () => {
    const postUrl = "https://www.linkedin.com/posts/example-recruiter_hiring-react-activity-222333444";
    const longCaption = [
      postUrl,
      "Example Recruiter",
      "We are hiring a Frontend Engineer in Bengaluru.",
      "Experience: 3+ Years",
      "Location: Bengaluru, India",
      "React Next.js TypeScript JavaScript Redux REST APIs",
      "Please review the role details below."
    ].concat(Array.from({ length: 12 }, () => "Responsibilities include building React interfaces, collaborating with product and engineering, and improving frontend quality.")).concat([
      "Interested candidates: please send your resume to recruiter@company-example.com."
    ]).join("\n");
    const provider = new LinkedInHiringPostEmailDiscovery();
    const result = await provider.discover({
      targetRoles: ["Frontend Developer", "React Developer"],
      skills: ["React", "Next.js", "TypeScript"],
      yearsExperience: 3,
      preferredLocations: ["Bengaluru", "India", "Remote"],
      maxQueries: 1,
      fetchText: async () => longCaption
    });
    expect(result.metrics.directEmails).toBe(1);
    expect(result.candidates[0]?.email).toBe("recruiter@company-example.com");
  });

  it("rejects a post outside the candidate experience range", async () => {
    const postUrl = "https://www.linkedin.com/posts/example-recruiter_frontend-activity-987654321";
    const page = [
      postUrl,
      "Hiring: Frontend Engineer | Pune",
      "Experience: 4–7 Years",
      "Location: Pune",
      "React.js Next.js TypeScript",
      "Send your resume to hiring@example.com"
    ].join("\n");

    const provider = new LinkedInHiringPostEmailDiscovery();
    const result = await provider.discover({
      targetRoles: ["Frontend Developer"],
      skills: ["React", "Next.js", "TypeScript"],
      yearsExperience: 3,
      preferredLocations: ["Bengaluru", "Pune", "India", "Remote"],
      maxQueries: 1,
      fetchText: async () => page
    });

    expect(result.candidates).toHaveLength(0);
  });
});
