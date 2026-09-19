import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";

describe("proactive recruiter profile fetch boundary integration", () => {
  afterEach(() => jest.restoreAllMocks());
  const profile = (url: string) => `Jane Doe - Technical Recruiter at Acme Corp currently hiring React engineers <${url}> jane@acme.com`;
  const htmlResponse = (body: string, status = 200, headers: Record<string,string> = {"content-type":"text/html"}) => ({ status, ok: status >= 200 && status < 300, headers: new Headers(headers), body: null, text: async () => body });

  it.each(["http://127.0.0.1/profile/jane","http://localhost/profile/jane","http://[::1]/profile/jane","http://10.0.0.1/profile/jane","http://192.168.1.10/profile/jane"])("rejects unsafe candidate URL %s before direct fetch or fallback", async (candidate) => {
    const search = profile(candidate);
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(htmlResponse(search) as unknown as Response);
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1 });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"], preferredLocations: ["Bengaluru"] });
    const metrics = service.getLastRunMetrics();
    expect(results).toEqual([]);
    expect(metrics.profileFetchAttempts).toBe(0);
    expect(metrics.profileEvidenceFallbackAttempts).toBe(0);
    expect(metrics.profileFetchFailureReasons.SSRF_BLOCKED).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(candidate))).toBe(false);
  });

  it("classifies profile HTTP failures without counting them as fetched or parsed", async () => {
    const candidate = "https://93.184.216.34/profile/jane";
    const search = profile(candidate);
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (url) => String(url).includes("93.184.216.34") ? htmlResponse("blocked", 403) as unknown as Response : htmlResponse(search) as unknown as Response);
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1 });
    await service.discover({ targetRoles: ["React Developer"], skills: ["React"] });
    const metrics = service.getLastRunMetrics();
    expect(metrics.profilesFetched).toBe(0);
    expect(metrics.profilesParsed).toBe(0);
    expect(metrics.profileFetchFailureReasons.HTTP_403).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("rejects non-profile content types at the fetch boundary", async () => {
    const candidate = "https://93.184.216.34/profile/jane";
    const search = profile(candidate);
    jest.spyOn(global, "fetch").mockImplementation(async (url) => String(url).includes("93.184.216.34") ? htmlResponse("pdf", 200, {"content-type":"application/pdf"}) as unknown as Response : htmlResponse(search) as unknown as Response);
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1 });
    await service.discover({ targetRoles: ["React Developer"], skills: ["React"] });
    expect(service.getLastRunMetrics().profilesFetched).toBe(0);
    expect(service.getLastRunMetrics().profileFetchFailureReasons.CONTENT_TYPE_REJECTED).toBeGreaterThan(0);
  });

  it("blocks a redirect to a private address before following it", async () => {
    const candidate = "https://93.184.216.34/profile/jane";
    const search = profile(candidate);
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (url) => String(url).includes("93.184.216.34") ? htmlResponse("", 302, {location:"http://127.0.0.1/internal", "content-type":"text/html"}) as unknown as Response : htmlResponse(search) as unknown as Response);
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1 });
    await service.discover({ targetRoles: ["React Developer"], skills: ["React"] });
    expect(service.getLastRunMetrics().profileFetchFailureReasons.REDIRECT_BLOCKED).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("127.0.0.1"))).toHaveLength(0);
  });

  it("accepts bounded HTML and counts it as fetched and parsed", async () => {
    const candidate = "https://93.184.216.34/profile/jane";
    const search = profile(candidate);
    const profilePage = `<html><head><title>Jane Doe | Technical Recruiter | Acme Corp</title></head><body><h1>Jane Doe</h1><p>Technical Recruiter at Acme Corp. Hiring React engineers.</p></body></html>`;
    jest.spyOn(global, "fetch").mockImplementation(async (url) => String(url).includes("93.184.216.34") ? htmlResponse(profilePage) as unknown as Response : htmlResponse(search) as unknown as Response);
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1 });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"] });
    expect(results).toHaveLength(1);
    expect(service.getLastRunMetrics().profilesFetched).toBeGreaterThan(0);
    expect(service.getLastRunMetrics().profilesParsed).toBeGreaterThan(0);
  });
});
