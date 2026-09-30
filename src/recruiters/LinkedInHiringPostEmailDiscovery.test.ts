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
