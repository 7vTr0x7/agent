import { fetchPublicEvidenceFallback } from "./PublicProfileEvidenceFallback";
import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";

describe("PublicProfileEvidenceFallback", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it.each([[403,"HTTP_403"],[429,"HTTP_429"],[500,"HTTP_5XX"],[502,"HTTP_5XX"],[503,"HTTP_5XX"]])("classifies HTTP %s without accepting it as evidence", async (status, reason) => {
    globalThis.fetch = jest.fn(async () => new Response("blocked", { status })) as typeof fetch;
    const result = await fetchPublicEvidenceFallback("https://example.com/in/jane-doe");
    expect(result.text).toBeNull(); expect(result.status).toBe(status); expect(result.reason).toBe(reason);
  });

  it("rejects localhost, private IP, IPv6 loopback and invalid URLs before network access", async () => {
    const fetchMock = jest.fn(); globalThis.fetch = fetchMock as typeof fetch;
    await expect(fetchPublicEvidenceFallback("http://localhost/in/jane-doe")).resolves.toMatchObject({ reason:"SSRF_BLOCKED" });
    await expect(fetchPublicEvidenceFallback("http://127.0.0.1/in/jane-doe")).resolves.toMatchObject({ reason:"SSRF_BLOCKED" });
    await expect(fetchPublicEvidenceFallback("http://[::1]/in/jane-doe")).resolves.toMatchObject({ reason:"SSRF_BLOCKED" });
    await expect(fetchPublicEvidenceFallback("not-a-url")).resolves.toMatchObject({ reason:"INVALID_URL" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-document and oversized responses", async () => {
    globalThis.fetch = jest.fn(async () => new Response("x", { status:200, headers:{"content-type":"image/png","content-length":"3000000"} })) as typeof fetch;
    await expect(fetchPublicEvidenceFallback("https://example.com/in/jane-doe")).resolves.toMatchObject({ reason:"CONTENT_TYPE_REJECTED" });
  });

  it("rejects anti-bot/error pages even when HTTP is successful", async () => {
    globalThis.fetch = jest.fn(async () => new Response("Verify you are human. CAPTCHA required. Checking your browser.", { status:200, headers:{"content-type":"text/plain"} })) as typeof fetch;
    await expect(fetchPublicEvidenceFallback("https://example.com/in/jane-doe")).resolves.toMatchObject({ reason:"ANTI_BOT" });
  });

  it("classifies transport timeout", async () => {
    globalThis.fetch = jest.fn(async () => { throw new Error("request timed out"); }) as typeof fetch;
    await expect(fetchPublicEvidenceFallback("https://example.com/in/jane-doe")).resolves.toMatchObject({ reason:"TIMEOUT" });
  });

  it("returns bounded public evidence when the fallback representation is usable", async () => {
    const profile = "<html><head><title>Jane Doe | Technical Recruiter at Acme</title><meta name=\"description\" content=\"Technical Recruiter at Acme hiring React engineers in Bengaluru\"></head><body><h1>Jane Doe</h1></body></html>";
    globalThis.fetch = jest.fn(async () => new Response(profile, { status:200, headers:{"content-type":"text/html"} })) as typeof fetch;
    const result = await fetchPublicEvidenceFallback("https://example.com/talent/jane-doe");
    expect(result.text).toContain("Jane Doe"); expect(result.finalUrl).toBeDefined();
  });

  it("integrates fallback evidence after a direct profile 5xx without counting it as a direct profile fetch", async () => {
    const searchPage = "Jane Doe — Technical Recruiter at Acme Corp currently hiring React engineers in Bengaluru <https://example.com/talent/jane-doe>";
    const profilePage = "<html><head><title>Jane Doe | Technical Recruiter | Acme Corp</title><meta name=\"description\" content=\"Technical Recruiter at Acme Corp currently hiring React engineers in Bengaluru\"></head><body><h1>Jane Doe</h1><p>Technical Recruiter at Acme Corp. Currently hiring React engineers in Bengaluru.</p></body></html>";
    globalThis.fetch = jest.fn(async (input) => { const url=String(input); if(url.includes("r.jina.ai/https://example.com/talent/jane-doe"))return new Response(profilePage,{status:200,headers:{"content-type":"text/html"}}); if(url.includes("example.com/talent/jane-doe"))return new Response("upstream unavailable",{status:503}); return new Response(searchPage,{status:200,headers:{"content-type":"text/plain"}}); }) as typeof fetch;
    const service=new ProactiveRecruiterDiscoveryService({maxQueries:1,targetCandidates:1});
    const results=await service.discover({targetRoles:["Frontend Engineer"],skills:["React"],preferredLocations:["Bengaluru"]}); const metrics=service.getLastRunMetrics();
    expect(results).toHaveLength(1); expect(results[0]?.recruiterName).toBe("Jane Doe"); expect(results[0]?.employer).toBe("Acme Corp"); expect(metrics.profileFetchAttempts).toBeGreaterThan(0); expect(metrics.profilesFetched).toBe(0); expect(metrics.profilesFetchFailures).toBeGreaterThan(0); expect(metrics.profileEvidenceFallbackAttempts).toBeGreaterThan(0); expect(metrics.profileEvidenceFallbackFetched).toBeGreaterThan(0); expect(metrics.profilesParsed).toBeGreaterThan(0);
  });

  it("does not promote query-only evidence after fallback content is unusable", async () => {
    const searchPage="Search query: site:linkedin.com/in technical recruiter Frontend Engineer Bengaluru <https://example.com/talent/jane-doe>";
    globalThis.fetch=jest.fn(async (input)=>{const url=String(input);if(url.includes("r.jina.ai/https://example.com/talent/jane-doe"))return new Response("Jane Doe profile",{status:200,headers:{"content-type":"text/plain"}});if(url.includes("example.com/talent/jane-doe"))return new Response("upstream unavailable",{status:503});return new Response(searchPage,{status:200,headers:{"content-type":"text/plain"}});}) as typeof fetch;
    const service=new ProactiveRecruiterDiscoveryService({maxQueries:1,targetCandidates:1}); const results=await service.discover({targetRoles:["Frontend Engineer"],skills:["React"],preferredLocations:["Bengaluru"]});
    expect(results).toEqual([]); expect(service.getLastRunMetrics().rejectionReasons.ROLE_IRRELEVANT).toBeGreaterThan(0);
  });
});
