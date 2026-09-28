import { LinkedInHiringPostDiscoveryProvider } from "./LinkedInHiringPostDiscoveryProvider";

describe("LinkedInHiringPostDiscoveryProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("extracts recruiter, public email, role, skills and hiring evidence from a LinkedIn post", async () => {
    const postUrl = "https://www.linkedin.com/posts/vinay-sharma_hiring-mern-stack-engineer-activity-123456789";
    const searchPage = [
      postUrl,
      "Vinay Sharma's Post 2d",
      "Hiring: MERN Stack Engineer | Pune | 3+ Years",
      "We're hiring a MERN Stack Engineer in Pune. MongoDB, Express.js, React.js, Node.js, JavaScript, TypeScript, REST APIs, Redux/Context API, JWT/OAuth, HTML5, CSS3, Jest and Git/GitHub.",
      "Please share your updated CV. Email: vinay.sharma@codersbrain.com"
    ].join("\n");
    const postPage = [
      "Vinay Sharma's Post",
      "HR / Talent Acquisition",
      "🚨 Hiring: MERN Stack Engineer | Pune | 3+ Years",
      "We are hiring a skilled MERN Stack Engineer for an exciting opportunity.",
      "Location: Pune",
      "Experience: 3+ Years",
      "Required Skills MongoDB, Express.js, React.js, Node.js, JavaScript (ES6+), TypeScript, REST API Development, Redux/Context API, JWT/OAuth, HTML5, CSS3, Jest, Git/GitHub.",
      "Please share your updated CV at vinay.sharma@codersbrain.com"
    ].join("\n");

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === postUrl) return new Response(postPage, { status: 200 });
      return new Response(searchPage, { status: 200 });
    }) as typeof fetch;

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

    global.fetch = jest.fn(async (input: RequestInfo | URL) => new Response(page, { status: 200 })) as typeof fetch;

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
});
