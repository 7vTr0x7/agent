import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";

const domainResolver = async (company: string): Promise<string | null> => `${company.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`;
const profile = { targetRoles: ["Frontend Engineer", "React Developer"], skills: ["React", "TypeScript"] };
const recruiterHtml = (name = "Jane Doe", employer = "Acme Corp") => `<a href="https://linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "-")}">${name} - ${employer} | LinkedIn</a> technical recruiter actively hiring React Developer`;

function mockPublicFetch(responses: Array<unknown>) {
  const fetchMock = jest.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { ok: true, text: async () => String(next ?? "") } as Response;
  });
  global.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

describe("ProactiveRecruiterDiscoveryService", () => {
  afterEach(() => jest.restoreAllMocks());

  it("builds deterministic role-specific location-aware recruiter searches without a giant OR expression", () => {
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => null });
    const queries = service.buildQueries({ targetRoles: ["Frontend Engineer", "React Developer", "Next.js Developer"], skills: ["React", "TypeScript", "Node.js"] });
    const normalized = queries.map((query) => query.toLowerCase());
    expect(queries.length).toBeGreaterThanOrEqual(8);
    expect(normalized.some((query) => query.includes("frontend engineer"))).toBe(true);
    expect(normalized.some((query) => query.includes("react developer"))).toBe(true);
    expect(normalized.some((query) => query.includes("bengaluru"))).toBe(true);
    expect(normalized.some((query) => query.includes("india"))).toBe(true);
    expect(queries.every((query) => !query.includes(" OR "))).toBe(true);
    expect(normalized.every((query) => !query.includes("node.js"))).toBe(true);
  });

  it("falls back to the deterministic LinkedIn site query when the primary provider response has no LinkedIn result", async () => {
    const fetchMock = mockPublicFetch(["<html>no matching public profile</html>", recruiterHtml()]);
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, resolveEmployerDomain: domainResolver });
    const results = await service.discover(profile);
    expect(results).toHaveLength(1);
    expect(results[0]?.recruiterName).toBe("Jane Doe");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("site%3Alinkedin.com%2Fin");
  });

  it("retries through the deterministic alternate query after a transient provider failure", async () => {
    const fetchMock = mockPublicFetch([new Error("temporary provider failure"), recruiterHtml("Aisha Khan", "Bright Labs")]);
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, resolveEmployerDomain: domainResolver });
    const results = await service.discover(profile);
    expect(results).toHaveLength(1);
    expect(results[0]?.recruiterName).toBe("Aisha Khan");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("continues to the next search endpoint after an empty primary and fallback response", async () => {
    const empty = Array.from({ length: 14 }, () => "<html>empty provider response</html>");
    empty[2] = recruiterHtml("Rahul Mehta", "NicheSolv");
    const fetchMock = mockPublicFetch(empty);
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, resolveEmployerDomain: domainResolver });
    const results = await service.discover(profile);
    expect(results).toHaveLength(1);
    expect(results[0]?.recruiterName).toBe("Rahul Mehta");
    expect(fetchMock.mock.calls.length).toBe(3);
  });

  it("extracts legitimate LinkedIn profile links while rejecting malformed and non-LinkedIn URLs", async () => {
    const html = `<a href="https://example.com/in/not-linkedin">Fake</a><a href="https://linkedin.com/company/acme">Company</a>${recruiterHtml("Sara Iyer", "Example Tech")} <a href="javascript:void(0)">bad</a>`;
    mockPublicFetch([html]);
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, resolveEmployerDomain: domainResolver });
    const results = await service.discover(profile);
    expect(results).toHaveLength(1);
    expect(results[0]?.discoveryUrl).toBe("https://linkedin.com/in/sara-iyer");
  });

  it("does not turn a LinkedIn profile into a recruiter without recruiter evidence", async () => {
    mockPublicFetch([`<a href="https://linkedin.com/in/jane-doe">Jane Doe - Software Engineer | LinkedIn</a>`]);
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, resolveEmployerDomain: domainResolver });
    await expect(service.discover(profile)).resolves.toEqual([]);
  });

  it("parses Name - Recruiter evidence and keeps discovered email unverified", async () => {
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => `Jane Doe - Technical Recruiter at Acme hiring React engineers | LinkedIn <https://linkedin.com/in/jane-doe> jane@acme.com`, resolveEmployerDomain: domainResolver });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React", "TypeScript"] });
    expect(results).toHaveLength(1); expect(results[0]?.recruiterName).toBe("Jane Doe"); expect(results[0]?.roleMatchScore).toBeGreaterThan(0); expect(results[0]?.email).toBe("jane@acme.com"); expect(results[0]?.emailStatus).toBe("UNVERIFIED"); expect(results[0]?.employer).toBe("Acme"); expect(results[0]?.employerDomain).toBe("acme.example");
  });

  it("parses Name - Company | LinkedIn evidence without requiring an email", async () => {
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => `Jane Doe - Acme Corp | LinkedIn technical recruiter hiring React Developer <https://linkedin.com/in/jane-doe>`, resolveEmployerDomain: domainResolver });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"] });
    expect(results).toHaveLength(1); expect(results[0]?.recruiterName).toBe("Jane Doe"); expect(results[0]?.employer).toBe("Acme Corp"); expect(results[0]?.employerDomain).toBe("acmecorp.example"); expect(results[0]?.email).toBeUndefined();
  });

  it("parses Name | LinkedIn evidence when recruiting context follows the profile heading", async () => {
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => `Aisha Khan | LinkedIn at Bright Labs technical recruiter recruiting Frontend Engineer and React Developer <https://linkedin.com/in/aisha-khan>`, resolveEmployerDomain: domainResolver });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results).toHaveLength(1); expect(results[0]?.recruiterName).toBe("Aisha Khan"); expect(results[0]?.employer).toBe("Bright Labs");
  });

  it("deduplicates the same public identity when multiple search responses contain the same profile", async () => {
    const html = `${recruiterHtml("Jane Doe", "Acme Corp")} ${recruiterHtml("Jane Doe", "Acme Corp")}`;
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => html, maxQueries: 2, resolveEmployerDomain: domainResolver });
    const results = await service.discover(profile);
    expect(results).toHaveLength(1);
    expect(results[0]?.discoveryUrl).toBe("https://linkedin.com/in/jane-doe");
  });

  it("classifies current, recent, and historical hiring evidence without treating history as current", async () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const pages = ["Alice Johnson - Acme | LinkedIn technical recruiter actively hiring React engineers <https://linkedin.com/in/alice-johnson>", "Robert Smith - Beta | LinkedIn technical recruiter 2026 recruiting frontend engineers <https://linkedin.com/in/robert-smith>", "Emily Davis - Gamma | LinkedIn technical recruiter 2023 previously recruited frontend engineers <https://linkedin.com/in/emily-davis>"];
    let index = 0;
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => pages[index++ % pages.length] ?? null, now: () => now, resolveEmployerDomain: domainResolver });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results.map((result) => result.evidenceFreshness).sort()).toEqual(["current", "historical", "recent"].sort());
  });
});
