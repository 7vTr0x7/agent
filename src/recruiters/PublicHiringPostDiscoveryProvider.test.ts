import { PublicHiringPostDiscoveryProvider } from "./PublicHiringPostDiscoveryProvider";

describe("PublicHiringPostDiscoveryProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("discovers a public hiring post, validates author hiring context, and preserves direct email provenance", async () => {
    const postUrl = "https://www.linkedin.com/posts/nikhil-pandey00_hiring-frontenddeveloper-reactjs-activity-7498076460147077121-X7ZB";
    const searchPage = [
      "# Frontend hiring",
      postUrl,
      "Nikhil Pandey’s Post",
      "Nikhil Pandey",
      "2d",
      "We're Hiring | Frontend Developer – React.js",
      "We are looking for a Frontend Developer – React.js at Synergy Talent Enterprise.",
      "Location: Bangalore (Hybrid)",
      "Experience: 2–5 Years",
      "Strong React.js, JavaScript, TypeScript, HTML, CSS, Tailwind CSS, Redux, REST APIs and GraphQL.",
      "DM Me or apply at hr@synergytalententerprise.com",
    ].join("\n");
    const profilePage = [
      "<title>Nikhil Pandey - Synergy Talent Enterprise | LinkedIn</title>",
      "About",
      "Driven HR professional | Talent acquisition, Job posting, Screening CV",
      "Experience",
      "Synergy Talent Enterprise"
    ].join("\n");

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(url.includes("/in/nikhil-pandey00") ? profilePage : searchPage, {
        status: 200,
        headers: { "content-type": "text/plain" }
      });
    }) as typeof fetch;

    const provider = new PublicHiringPostDiscoveryProvider();
    const result = await provider.discover({
      targetRoles: ["Frontend Engineer", "Frontend Developer", "React Developer"],
      skills: ["React", "Next.js", "TypeScript", "JavaScript"],
      preferredLocations: ["Bengaluru", "India", "Remote"],
      maxQueries: 1
    });

    expect(result.metrics.queriesGenerated).toBe(1);
    expect(result.metrics.hiringIntentPosts).toBeGreaterThan(0);
    expect(result.metrics.relevantRolePosts).toBeGreaterThan(0);
    expect(result.metrics.authorsExtracted).toBe(1);
    expect(result.metrics.employersExtracted).toBe(1);
    expect(result.metrics.validatedIdentities).toBe(1);
    expect(result.metrics.directEmails).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      recruiterName: "Nikhil Pandey",
      employer: "Synergy Talent Enterprise",
      employerDomain: "synergytalententerprise.com",
      email: "hr@synergytalententerprise.com",
      emailStatus: "UNVERIFIED",
      evidenceType: "job_hiring_evidence",
      discoveryUrl: postUrl,
    });
    expect(result.candidates[0].discoveryEvidence.join(" ")).toContain("We're Hiring");
    expect(result.candidates[0].discoveryEvidence.join(" ")).toContain("hr@synergytalententerprise.com");
  });

  it("rejects relevant-looking posts when the author lacks hiring-role evidence", async () => {
    const postUrl = "https://www.linkedin.com/posts/example-user_hiring-frontend-activity-1234567890-test";
    const searchPage = [
      postUrl,
      "Example User’s Post",
      "Example User",
      "2d",
      "We're Hiring | Frontend Developer",
      "We are looking for a Frontend Developer at Example Corp.",
      "React TypeScript JavaScript",
      "DM me",
    ].join("\n");

    global.fetch = jest.fn(async () => new Response(searchPage, { status: 200 })) as typeof fetch;

    const provider = new PublicHiringPostDiscoveryProvider();
    const result = await provider.discover({
      targetRoles: ["Frontend Developer"],
      skills: ["React", "TypeScript"],
      maxQueries: 1
    });

    expect(result.metrics.hiringIntentPosts).toBeGreaterThan(0);
    expect(result.metrics.relevantRolePosts).toBeGreaterThan(0);
    expect(result.candidates).toHaveLength(0);
    expect(result.metrics.validatedIdentities).toBe(0);
  });

  it("deduplicates the same canonical post returned by multiple search providers", async () => {
    const postUrl = "https://www.linkedin.com/posts/example-user_hiring-frontend-activity-1234567890-test?utm_source=google";
    const searchPage = [
      postUrl,
      "Example User’s Post",
      "Example User",
      "2d",
      "We're Hiring | Frontend Developer at Example Corp.",
      "React TypeScript",
      "Recruiter at Example Corp. DM me",
      "recruiter@example.com"
    ].join("\n");

    global.fetch = jest.fn(async () => new Response(searchPage, { status: 200 })) as typeof fetch;

    const provider = new PublicHiringPostDiscoveryProvider();
    const result = await provider.discover({
      targetRoles: ["Frontend Developer"],
      skills: ["React", "TypeScript"],
      maxQueries: 1
    });

    expect(result.metrics.publicPostUrls).toBe(1);
    expect(result.metrics.duplicatePosts).toBeGreaterThan(0);
    expect(result.candidates).toHaveLength(1);
  });
});
