import { LinkedInHiringPostDiscoveryProvider } from "./LinkedInHiringPostDiscoveryProvider";

describe("LinkedInHiringPostDiscoveryProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    delete process.env.LINKEDIN_HIRING_POST_MAX_QUERIES;
    delete process.env.LINKEDIN_HIRING_POST_TIMEOUT_MS;
    delete process.env.CANDIDATE_YEARS;
  });

  function mockSearch(page: string): void {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("linkedin.com/")) throw new Error("LinkedIn pages must never be fetched directly");
      return new Response(page, { status: 200, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
  }

  it("extracts recruiter, public email, role and hiring evidence from a search-indexed LinkedIn post", async () => {
    const postUrl = "https://www.linkedin.com/posts/vinay-sharma_hiring-mern-stack-engineer-activity-123456789";
    mockSearch([postUrl, "Vinay Sharma's Post 2d", "Hiring: MERN Stack Engineer / Frontend Engineer | Pune | 3+ Years", "We're hiring a MERN Stack Engineer / Frontend Engineer in Pune. MongoDB, Express.js, React.js, Node.js, JavaScript, TypeScript, REST APIs, Redux/Context API, JWT/OAuth, HTML5, CSS3, Jest and Git/GitHub.", "Please share your updated CV. Email: vinay.sharma@codersbrain.com"].join("\n"));
    process.env.LINKEDIN_HIRING_POST_MAX_QUERIES = "1";
    const result = await new LinkedInHiringPostDiscoveryProvider().discover({ companyName: "CodersBrain", companyDomain: "codersbrain.com", jobTitle: "Frontend Developer", jobDescription: "React TypeScript JavaScript Node.js REST APIs", location: "Pune", candidateProfileId: "candidate-1" });
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]).toMatchObject({ email: "vinay.sharma@codersbrain.com", fullName: "Vinay Sharma", provider: "linkedin-hiring-posts", companyDomain: "codersbrain.com", verified: false });
    expect(result.contacts[0]?.discoveryEvidence?.join(" ")).toContain("MERN Stack Engineer");
    expect(result.contacts[0]?.sources[0]?.type).toBe("linkedin_hiring_post_search_evidence");
    expect(result.metrics?.linkedinUrls).toBeGreaterThan(0);
  });

  it("accepts a title variation instead of requiring an exact configured title", async () => {
    const postUrl = "https://www.linkedin.com/posts/tanya-pandey_frontend-digital-products-activity-987654321";
    mockSearch([postUrl, "Tanya Pandey's Post 1d", "Hiring: Developer – Digital Products (Frontend)", "We're looking for a Frontend Developer – Digital Products with 2–4 years of experience.", "TypeScript, React 18, React Hooks, REST APIs, OAuth, Jest, React Testing Library, Playwright, Next.js.", "Send your updated resume to tanya.pandey@appzime.com"].join("\n"));
    process.env.LINKEDIN_HIRING_POST_MAX_QUERIES = "1";
    const result = await new LinkedInHiringPostDiscoveryProvider().discover({ companyName: "Appzime", companyDomain: "appzime.com", jobTitle: "React Developer", jobDescription: "React Next.js TypeScript", location: "Noida", candidateProfileId: "candidate-1" });
    expect(result.contacts[0]?.email).toBe("tanya.pandey@appzime.com");
  });

  it("rejects generic and non-recruiting mailboxes while retaining useful recruiter identity evidence", async () => {
    const postUrl = "https://www.linkedin.com/posts/example_hiring-frontend-activity-123456789";
    mockSearch([postUrl, "Example Recruiter 2d", "We're hiring a Frontend Developer in Bengaluru. React and TypeScript.", "Send your resume to sales@w3schools.com", "Also contact support@w3schools.com for questions."].join("\n"));
    process.env.LINKEDIN_HIRING_POST_MAX_QUERIES = "1";
    const result = await new LinkedInHiringPostDiscoveryProvider().discover({ companyName: "W3Schools", companyDomain: "w3schools.com", jobTitle: "Frontend Developer", jobDescription: "React TypeScript", location: "Bengaluru", candidateProfileId: "candidate-1" });
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.email).toBe("");
    expect(result.contacts[0]?.fullName).toBe("Example Recruiter");
  });

  it("keeps a legitimate employer recruiting mailbox unverified", async () => {
    const postUrl = "https://www.linkedin.com/posts/nextgraph_hiring-frontend-activity-123456789";
    mockSearch([postUrl, "NextGraph Team 1w", "We are hiring a Frontend Developer for an open source project.", "React and TypeScript. Fully remote.", "Send a short message to job@nextgraph.org", "Jun 9, 2026"].join("\n"));
    process.env.LINKEDIN_HIRING_POST_MAX_QUERIES = "1";
    const result = await new LinkedInHiringPostDiscoveryProvider().discover({ companyName: "NextGraph", companyDomain: "nextgraph.org", jobTitle: "Frontend Developer", jobDescription: "React TypeScript", location: "Remote", candidateProfileId: "candidate-1" });
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]).toMatchObject({ email: "job@nextgraph.org", companyDomain: "nextgraph.org", verified: false, verificationStatus: "public_hiring_post_unverified" });
  });

  it("deduplicates the same post returned by multiple search providers", async () => {
    const postUrl = "https://www.linkedin.com/posts/example-user_hiring-frontend-activity-123456789";
    mockSearch([postUrl, "Example User's Post 2d", "Recruiter at Example Corp", "We're hiring a Frontend Developer. React TypeScript.", "Send your resume to recruiter@examplecorp.com"].join("\n"));
    process.env.LINKEDIN_HIRING_POST_MAX_QUERIES = "1";
    const result = await new LinkedInHiringPostDiscoveryProvider().discover({ companyName: "Example Corp", companyDomain: "examplecorp.com", jobTitle: "Frontend Developer", jobDescription: "React TypeScript", location: "India", candidateProfileId: "candidate-1" });
    expect(result.contacts).toHaveLength(1);
    expect(result.metrics?.duplicateCandidates).toBeGreaterThan(0);
  });
});
