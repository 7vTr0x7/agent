import { PublicHiringPostDiscoveryProvider } from "./PublicHiringPostDiscoveryProvider";
import { sourceList } from "./PublicSearchProviderRegistry";

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
      "https://www.linkedin.com/in/nikhil-pandey00",
      postUrl,
      "Frontend hiring result",
      "2d",
      "We're Hiring | Frontend Developer – React.js",
      "We are looking for a Frontend Developer – React.js at Synergy Talent Enterprise.",
      "Location: Bangalore (Hybrid)",
      "Experience: 2–5 Years",
      "Strong React.js, JavaScript, TypeScript, HTML, CSS, Tailwind CSS, Redux, REST APIs and GraphQL.",
      "DM Me or apply at hr@synergytalententerprise.com",
    ].join("\n");
    const postPage = [
      "<title>We're Hiring | Frontend Developer – React.js</title>",
      "Nikhil Pandey's Post",
      "Nikhil Pandey",
      "HR professional | Talent acquisition | hiring contact",
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
      return new Response(url.includes("/in/nikhil-pandey00") ? profilePage : url.includes("nikhil-pandey00_hiring-frontenddeveloper-reactjs-activity-7498076460147077121-X7ZB") ? postPage : searchPage, {
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

    expect(result.metrics.queriesGenerated).toBeGreaterThan(1);
    expect(result.metrics.configuredProviders).toBeGreaterThan(2);
    expect(result.metrics.eligibleProviders).toBe(result.metrics.configuredProviders);
    expect(result.metrics.executedProviders).toBe(result.metrics.eligibleProviders);
    expect(result.metrics.normalizedResults).toBeGreaterThan(0);
    expect(result.metrics.hiringIntentPosts).toBeGreaterThan(0);
    expect(result.metrics.relevantRolePosts).toBeGreaterThan(0);
    expect(result.metrics.authorsExtracted).toBe(1);
    expect(result.metrics.employersExtracted).toBe(1);
    expect(result.metrics.validatedIdentities).toBe(1);
    expect(result.metrics.directEmails).toBe(1);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0]!;
    expect(candidate).toMatchObject({
      recruiterName: "Nikhil Pandey",
      employer: "Synergy Talent Enterprise",
      employerDomain: "synergytalententerprise.com",
      email: "hr@synergytalententerprise.com",
      emailStatus: "UNVERIFIED",
      evidenceType: "job_hiring_evidence",
      discoveryUrl: postUrl,
    });
    expect(candidate.discoveryEvidence.join(" ")).toContain("We're Hiring");
    expect(candidate.discoveryEvidence.join(" ")).toContain("hr@synergytalententerprise.com");
  });

  it("considers every configured search provider without an arbitrary provider-count ceiling", async () => {
    const observed = new Set<string>();
    const provider = new PublicHiringPostDiscoveryProvider();
    const result = await provider.discover({
      targetRoles: ["Frontend Developer"],
      skills: ["React"],
      maxQueries: 1,
      fetchText: async (url) => { observed.add(new URL(url).hostname); return "no relevant results"; }
    });
    expect(result.metrics.configuredProviders).toBeGreaterThan(2);
    expect(result.metrics.executedProviders).toBe(result.metrics.configuredProviders);
    expect(observed.size).toBeGreaterThan(2);
  });

  it("rejects Qwant search-shell infrastructure URLs while preserving legitimate external result URLs", async () => {
    const qwantShell = [
      "<html><head><title>\"Frontend Engineer\" hiring React – Qwant Search</title></head><body>",
      "<script src=\"https://dd.qwant.com/tags.js\"></script>",
      "<img src=\"https://www.w3.org/2000/svg\">",
      "<a href=\"https://chrome.google.com/webstore/detail/extension-id\">extension</a>",
      "<a href=\"https://mn.qwant.com/v2\">api</a>",
      "<a href=\"https://api.qwant.com/v3\">api</a>",
      "<a href=\"https://www.qwant.com/?q=frontend\">search</a>",
      "<a href=\"https://example.com/careers/frontend-engineer\">Frontend Engineer — Example Corp</a>",
      "<p>We're hiring a Frontend Engineer. Posted 2d. Example Corp is hiring React engineers.</p>",
      "</body></html>"
    ].join("\n");

    global.fetch = jest.fn(async () => new Response(qwantShell, {
      status: 200,
      headers: { "content-type": "text/html" }
    })) as typeof fetch;

    const provider = new PublicHiringPostDiscoveryProvider();
    const result = await provider.discover({
      targetRoles: ["Frontend Engineer"],
      skills: ["React", "TypeScript"],
      maxQueries: 1
    });

    expect(result.metrics.normalizedResults).toBeGreaterThanOrEqual(1);
    expect(result.metrics.publicPostUrls).toBeGreaterThanOrEqual(1);
    const evidence = result.candidates.flatMap(candidate => candidate.discoveryEvidence).join(" ");
    expect(evidence).not.toContain("mn.qwant.com/v2");
    expect(evidence).not.toContain("api.qwant.com/v3");
    expect(evidence).not.toContain("dd.qwant.com/tags.js");
    expect(evidence).not.toContain("chrome.google.com/webstore");
    expect(result.candidates.every(candidate => candidate.discoveryUrl !== "https://api.qwant.com/v3")).toBe(true);
    expect(result.candidates.every(candidate => candidate.discoveryUrl !== "https://www.qwantjunior.com")).toBe(true);
    expect(result.candidates.every(candidate => candidate.discoveryUrl !== "https://about.qwant.com/en")).toBe(true);
    expect(result.candidates.every(candidate => candidate.discoveryUrl !== "https://www.welcometothejungle.com/en/companies/qwant")).toBe(true);
  });

  it("accepts a legitimate employer recruiting email when no person identity is established", async () => {
    const postUrl = "https://nextgraph.org/hiring-frontend-developer";
    const searchPage = [
      postUrl,
      "We are hiring a front-end developer - React, Svelte",
      "The NextGraph association is pleased to announce it is opening a position for an open source front-end developer.",
      "Fully remote and European based.",
      "Send us a short message to job@nextgraph.org",
      "Jun 9, 2026"
    ].join("\n");
    const postPage = [
      "<title>We are hiring a front-end developer - React, Svelte — NextGraph</title>",
      "Jun 9, 2026",
      "We are hiring a front-end developer - React, Svelte",
      "The NextGraph association is pleased to announce it is opening a position for an open source front-end developer, fulltime or part-time, fully remote and European based, working with React and/or Svelte frameworks.",
      "We are fully funded and hiring immediately or in the coming months.",
      "Send us a short message to job@nextgraph.org"
    ].join("\n");

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(url === postUrl ? postPage : searchPage, { status: 200, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;

    const provider = new PublicHiringPostDiscoveryProvider();
    const result = await provider.discover({
      targetRoles: ["Frontend Developer", "React Developer"],
      skills: ["React", "TypeScript"],
      maxQueries: 1
    });

    expect(result.metrics.hiringIntentPosts).toBeGreaterThan(0);
    expect(result.metrics.relevantRolePosts).toBeGreaterThan(0);
    expect(result.metrics.authorsExtracted).toBe(0);
    expect(result.metrics.validatedContacts).toBe(1);
    expect(result.metrics.directEmails).toBeGreaterThan(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      contactType: "EMPLOYER",
      recruiterName: "Employer recruiting contact",
      employer: "Nextgraph",
      employerDomain: "nextgraph.org",
      email: "job@nextgraph.org",
      emailStatus: "UNVERIFIED",
      discoverySource: "public-web",
      discoveryUrl: postUrl
    });
    expect(result.candidates[0]?.discoveryEvidence.join(" ")).toContain("job@nextgraph.org");
  });

  it("rejects generic prose employers and automated mailbox evidence", async () => {
    const postUrl = "https://example.com/hiring-frontend";
    const postPage = [
      "<title>Frontend hiring announcement</title>",
      "We're hiring a Frontend Developer. Our team works at scale.",
      "Send questions to i-am-a-machine@example.com",
      "React TypeScript",
      "2026"
    ].join("\n");
    global.fetch = jest.fn(async (input: RequestInfo | URL) => new Response(String(input) === postUrl ? postPage : postUrl + "\n" + postPage, { status: 200 })) as typeof fetch;
    const provider = new PublicHiringPostDiscoveryProvider();
    const result = await provider.discover({ targetRoles: ["Frontend Developer"], skills: ["React"], maxQueries: 1 });
    expect(result.candidates).toHaveLength(0);
    expect(result.metrics.validatedContacts).toBe(0);
  });

  it("rejects footer/support emails that are not recruiting contact evidence", async () => {
    const postUrl = "https://bebee.com/gb/jobs/frontend-developer-react-remote";
    const searchPage = [postUrl, "Frontend Developer (React) (Remote)", "We are hiring for one of our clients, seeking a Frontend Developer (React)."].join("\n");
    const postPage = [
      "<title>Frontend Developer (React) (Remote) - Hired | BeBee</title>",
      "Frontend Developer (React) (Remote)",
      "We are hiring for one of our clients, seeking a Frontend Developer (React) to work on a contract basis.",
      "Apply Now",
      "support@bebee.com"
    ].join("\n");
    global.fetch = jest.fn(async (input: RequestInfo | URL) => new Response(String(input) === postUrl ? postPage : searchPage, { status: 200 })) as typeof fetch;

    const provider = new PublicHiringPostDiscoveryProvider();
    const result = await provider.discover({ targetRoles: ["Frontend Developer"], skills: ["React"], maxQueries: 1 });

    expect(result.metrics.relevantRolePosts).toBeGreaterThan(0);
    expect(result.candidates).toHaveLength(0);
    expect(result.metrics.validatedContacts).toBe(0);
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
    const postUrl = "https://www.linkedin.com/posts/example-user_hiring-frontend-activity-1234567890-test";
    const searchPage = [
      postUrl,
      "https://www.linkedin.com/in/example-user",
      "Example User’s Post",
      "Example User",
      "2d",
      "We're Hiring | Frontend Developer at Example Corp.",
      "React TypeScript",
      "Recruiter at Example Corp. DM me",
      "recruiter@example.com"
    ].join("\n");

    const profilePage = "<title>Example User - Example Corp | LinkedIn</title> Recruiter at Example Corp. Currently hiring frontend engineers.";
    global.fetch = jest.fn(async (input: RequestInfo | URL) => new Response(String(input).includes("/in/example-user") ? profilePage : searchPage, { status: 200 })) as typeof fetch;

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
