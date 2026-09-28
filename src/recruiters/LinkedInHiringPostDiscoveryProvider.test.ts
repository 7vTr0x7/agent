import { LinkedInHiringPostDiscoveryProvider } from "./LinkedInHiringPostDiscoveryProvider";

describe("LinkedInHiringPostDiscoveryProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("extracts recruiter, public email, role, skills and hiring evidence from indexed LinkedIn post content", async () => {
    const postUrl = "https://www.linkedin.com/posts/vinay-sharma_hiring-mern-stack-engineer-activity-123456789";
    const searchPage = [
      postUrl,
      "Vinay Sharma's Post 2d",
      "Hiring: MERN Stack Engineer | Pune | 3+ Years",
      "We're hiring a MERN Stack Engineer in Pune. MongoDB, Express.js, React.js, Node.js, JavaScript, TypeScript, REST APIs, Redux/Context API, JWT/OAuth, HTML5, CSS3, Jest and Git/GitHub.",
      "Please share your updated CV. Email: vinay.sharma@codersbrain.com",
      "HR / Talent Acquisition"
    ].join("\n");

    global.fetch = jest.fn(async () => new Response(searchPage, { status: 200 })) as typeof fetch;

    const provider = new LinkedInHiringPostDiscoveryProvider();
    const result = await provider.discover({
      companyName: "CodersBrain",
      companyDomain: "codersbrain.com",
      jobTitle: "Frontend Developer",
      jobDescription: "React TypeScript JavaScript Node.js REST APIs",
      location: "Pune",
      candidateProfileId: "candidate-1"
    });

    expect(result.contacts.length).toBeGreaterThan(0);
    expect(result.contacts[0]).toMatchObject({
      email: "vinay.sharma@codersbrain.com",
      fullName: "Vinay Sharma",
      provider: "linkedin-hiring-post",
      companyDomain: "codersbrain.com",
      verified: false
    });
    expect(result.contacts[0]?.discoveryEvidence?.join(" ")).toContain("MERN Stack Engineer");
    expect(result.contacts[0]?.discoveryEvidence?.join(" ")).toContain("React.js");
    expect(result.contacts[0]?.sources[0]?.type).toBe("linkedin_hiring_post");
    expect(result.metrics?.linkedinUrls).toBeGreaterThan(0);
  });

  it("does not require the post title to exactly equal the configured job title", async () => {
    const postUrl = "https://www.linkedin.com/posts/tanya-pandey_frontend-digital-products-activity-987654321";
    const page = [
      postUrl,
      "Tanya Pandey's Post 1d",
      "Hiring: Developer – Digital Products (Frontend)",
      "We're looking for a Frontend Developer – Digital Products with 2–4 years of experience.",
      "TypeScript, React 18, React Hooks, state management, REST APIs, OAuth, Jest, React Testing Library, Playwright, Next.js.",
      "Send your updated resume to tanya.pandey@appzime.com"
    ].join("\n");

    global.fetch = jest.fn(async () => new Response(page, { status: 200 })) as typeof fetch;

    const provider = new LinkedInHiringPostDiscoveryProvider();
    const result = await provider.discover({
      companyName: "Appzime",
      companyDomain: "appzime.com",
      jobTitle: "React Developer",
      jobDescription: "React Next.js TypeScript",
      location: "Noida",
      candidateProfileId: "candidate-1"
    });

    expect(result.contacts.length).toBeGreaterThan(0);
    expect(result.contacts[0]?.email).toBe("tanya.pandey@appzime.com");
    expect(result.contacts[0]?.discoveryEvidence?.join(" ")).toContain("Developer – Digital Products");
  });

  it("rejects generic or unrelated emails even when they appear in a hiring snippet", async () => {
    const postUrl = "https://www.linkedin.com/posts/example_hiring-frontend-activity-555555555";
    const page = [
      postUrl,
      "Rohit Mehta's Post 1d",
      "We're hiring a Frontend Engineer in Bengaluru. React TypeScript Next.js.",
      "Do not use sales@example.com or support@example.com. Send your resume to hiring@example.com",
      "Talent Acquisition"
    ].join("\n");

    global.fetch = jest.fn(async () => new Response(page, { status: 200 })) as typeof fetch;

    const provider = new LinkedInHiringPostDiscoveryProvider();
    const result = await provider.discover({
      companyName: "Example Corp",
      companyDomain: "example.com",
      jobTitle: "Frontend Engineer",
      jobDescription: "React TypeScript Next.js",
      location: "Bengaluru",
      candidateProfileId: "candidate-1"
    });

    expect(result.contacts).toHaveLength(0);
  });
});
