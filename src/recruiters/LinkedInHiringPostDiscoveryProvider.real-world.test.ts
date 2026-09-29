import { LinkedInHiringPostDiscoveryProvider } from "./LinkedInHiringPostDiscoveryProvider";

describe("LinkedIn hiring posts real-world calibration", () => {
  const originalFetch = global.fetch;
  beforeEach(() => { process.env.LINKEDIN_HIRING_POST_MAX_QUERIES = "1"; process.env.LINKEDIN_HIRING_POST_TIMEOUT_MS = "2000"; });
  afterEach(() => { global.fetch = originalFetch; delete process.env.LINKEDIN_HIRING_POST_MAX_QUERIES; delete process.env.LINKEDIN_HIRING_POST_TIMEOUT_MS; delete process.env.CANDIDATE_YEARS; jest.restoreAllMocks(); });

  it("accepts an explicit HR mailbox from a recruiting post", async () => {
    const post = "https://www.linkedin.com/posts/vinay-sharma_hiring-mern-activity-111";
    const page = [post, "Vinay Sharma's Post 2d", "Hiring now", "Responsibilities: build React and Node.js applications, REST APIs, MongoDB, TypeScript and responsive interfaces. Experience: 3+ years.", "Please share your CV. Email: hr@codersbrain.com"].join("\n");
    global.fetch = jest.fn(async (input: RequestInfo | URL) => new Response(String(input).includes("linkedin.com/") ? page : page, { status: 200, headers: { "content-type": "text/plain" } })) as typeof fetch;
    const result = await new LinkedInHiringPostDiscoveryProvider().discover({ companyName: "CodersBrain", companyDomain: "codersbrain.com", jobTitle: "Frontend Developer", jobDescription: "React Next.js TypeScript JavaScript", location: "Pune", candidateProfileId: "candidate-1" });
    expect(result.contacts.some(contact => contact.email === "hr@codersbrain.com")).toBe(true);
  });

  it("accepts Front End spelling and generic role titles when the body is substantively React/Next.js work", async () => {
    const post = "https://www.linkedin.com/posts/tanya-pandey_digital-products-activity-222";
    const page = [post, "Tanya Pandey's Post 1d", "Hiring: Developer – Digital Products", "Responsibilities: build user-facing experiences with React 18 and TypeScript, reusable components, REST APIs, OAuth, loading/error states, responsive design, Core Web Vitals and Jest/Playwright. Experience: 2–4 years.", "Send your updated resume to careers@appzime.com"].join("\n");
    global.fetch = jest.fn(async (input: RequestInfo | URL) => new Response(String(input).includes("linkedin.com/") ? page : page, { status: 200, headers: { "content-type": "text/plain" } })) as typeof fetch;
    const result = await new LinkedInHiringPostDiscoveryProvider().discover({ companyName: "Appzime", companyDomain: "appzime.com", jobTitle: "React Developer", jobDescription: "React Next.js TypeScript", location: "Noida", candidateProfileId: "candidate-1" });
    expect(result.contacts.some(contact => contact.email === "careers@appzime.com")).toBe(true);
  });

  it("does not classify a GIS/Maximo-only frontend post as a React frontend match", async () => {
    const post = "https://www.linkedin.com/posts/vibintech_application-developer-activity-333";
    const page = [post, "Hiring 1d", "Responsibilities: JavaScript, Python, SQL, Fulcrum and Maximo integration, Esri GIS, PostGIS, Mapbox, QGIS and TileMill. Experience: 3–5 years.", "Apply: hr@vibintechnologies.com"].join("\n");
    global.fetch = jest.fn(async (input: RequestInfo | URL) => new Response(String(input).includes("linkedin.com/") ? page : page, { status: 200, headers: { "content-type": "text/plain" } })) as typeof fetch;
    const result = await new LinkedInHiringPostDiscoveryProvider().discover({ companyName: "Vibin Technologies", companyDomain: "vibintechnologies.com", jobTitle: "Frontend Developer", jobDescription: "React Next.js TypeScript JavaScript", location: "Bangalore", candidateProfileId: "candidate-1" });
    expect(result.contacts).toHaveLength(0);
  });
});
