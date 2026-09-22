import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";

describe("ProactiveRecruiterDiscoveryService", () => {
  it("builds deterministic recruiter searches from candidate roles and skills without requiring a job", () => {
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => null });
    const queries = service.buildQueries({ targetRoles: ["Frontend Engineer"], skills: ["React", "TypeScript"], preferredLocations: ["Bengaluru", "India"] });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]).toMatch(/frontend engineer/i);
    expect(queries[0]).toContain("Bengaluru");
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("uses the public Jina search endpoint when no Jina API key is configured", async () => {
    const target = "https://www.linkedin.com/in/anita-recruiter";
    const profile = `<html><head><title>Anita Rao | Technical Recruiter | Acme Corp</title></head><body><h1>Anita Rao</h1><p>Technical Recruiter at Acme Corp. Hiring React engineers in Bengaluru.</p></body></html>`;
    const search = `Anita Rao — Technical Recruiter at Acme Corp <${target}>`;
    const calls:string[] = [];
    const service = new ProactiveRecruiterDiscoveryService({
      maxQueries: 1,
      fetchText: async (url) => {
        calls.push(url);
        if (url.startsWith("https://s.jina.ai/")) return search;
        if (url === target) return profile;
        return "";
      }
    });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"], preferredLocations: ["Bengaluru"] });
    expect(calls.some((url) => url.startsWith("https://s.jina.ai/"))).toBe(true);
    expect(results[0]?.recruiterName).toBe("Anita Rao");
    expect(results[0]?.discoveryUrl).toBe(target);
    expect(service.getLastRunMetrics().linkedinUrlsExtracted).toBeGreaterThan(0);
    expect(service.getLastRunMetrics().profileFetchAttempts).toBeGreaterThan(0);
  });

  it("rejects search infrastructure person-photo URLs as public profiles", async () => {
    const infrastructure = "Search results <https://business.bing.com/api/v3/search/person/photo?caller=IP%5Cu0026id%3D%7B0%7D>";
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => infrastructure });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results).toEqual([]);
    expect(service.getLastRunMetrics().publicProfileUrlsExtracted).toBe(0);
    expect(service.getLastRunMetrics().profileFetchAttempts).toBe(0);
  });

  it("unwraps search-provider redirect URLs before profile classification", async () => {
    const redirect = "https://www.google.com/url?q=" + encodeURIComponent("https://example.com/talent/maya-singh");
    const search = `Maya Singh — Technical Recruiter at Acme Corp <${redirect}>`;
    const profile = `<html><head><title>Maya Singh | Technical Recruiter | Acme Corp</title></head><body><h1>Maya Singh</h1><p>Technical Recruiter at Acme Corp. Hiring React engineers in Bengaluru.</p></body></html>`;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async (url) => url.includes("example.com/talent/maya-singh") ? profile : search });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"], preferredLocations: ["Bengaluru"] });
    expect(results[0]?.recruiterName).toBe("Maya Singh");
    expect(results[0]?.discoveryUrl).toContain("example.com/talent/maya-singh");
  });

  it("unwraps Bing ck/a base64 redirect URLs before public profile classification", async () => {
    const target = "https://www.linkedin.com/in/priya-sharma";
    const payload = Buffer.from(target, "utf8").toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const redirect = "https://www.bing.com/ck/a?u=a1" + payload;
    const search = `Priya Sharma — Technical Recruiter at Acme Corp <${redirect}>`;
    const profile = `<html><head><title>Priya Sharma | Technical Recruiter | Acme Corp</title></head><body><h1>Priya Sharma</h1><p>Technical Recruiter at Acme Corp. Hiring React engineers in Bengaluru.</p></body></html>`;
    const service = new ProactiveRecruiterDiscoveryService({
      maxQueries: 1,
      fetchText: async (url) => url === target ? profile : search
    });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"], preferredLocations: ["Bengaluru"] });
    expect(results[0]?.recruiterName).toBe("Priya Sharma");
    expect(results[0]?.discoveryUrl).toBe(target);
    expect(service.getLastRunMetrics().linkedinUrlsExtracted).toBeGreaterThan(0);
    expect(service.getLastRunMetrics().profileFetchAttempts).toBeGreaterThan(0);
    expect(service.getLastRunMetrics().profilesParsed).toBeGreaterThan(0);
  });

  it("extracts a LinkedIn public profile from a search-result HTML href before profile fetch", async () => {
    const target = "https://www.linkedin.com/in/jane-doe?trk=public_profile";
    const search = `<html><body><a href="${target}">Jane Doe — Technical Recruiter at Acme Corp</a></body></html>`;
    const profile = `<html><head><title>Jane Doe | Technical Recruiter | Acme Corp</title></head><body><h1>Jane Doe</h1><p>Technical Recruiter at Acme Corp. Hiring React engineers in Bengaluru.</p></body></html>`;
    const service = new ProactiveRecruiterDiscoveryService({
      maxQueries: 1,
      fetchText: async (url) => url === "https://www.linkedin.com/in/jane-doe" ? profile : search
    });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"], preferredLocations: ["Bengaluru"] });
    expect(results[0]?.recruiterName).toBe("Jane Doe");
    expect(results[0]?.discoveryUrl).toBe("https://www.linkedin.com/in/jane-doe");
    expect(service.getLastRunMetrics().linkedinUrlsExtracted).toBeGreaterThan(0);
    expect(service.getLastRunMetrics().publicProfileUrlsExtracted).toBeGreaterThan(0);
    expect(service.getLastRunMetrics().profileFetchAttempts).toBeGreaterThan(0);
  });

  it("rejects LinkedIn authwall/error pages as parsed profiles while accepting the same real recruiter shape", async () => {
    const authwall = `https://www.linkedin.com/in/jane-doe Title: Sign Up | LinkedIn Markdown Content: Agree & Join LinkedIn By clicking Continue to join or sign in`;
    const recruiter = `<html><head><title>Jane Doe | Technical Recruiter | Acme Corp</title></head><body><h1>Jane Doe</h1><p>Technical Recruiter at Acme Corp. Hiring React engineers in Bengaluru.</p><a href="https://www.linkedin.com/in/jane-doe">Jane Doe on LinkedIn</a></body></html>`;
    const authwallService = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => authwall });
    expect(await authwallService.discover({ targetRoles: ["React Developer"], skills: ["React"] })).toEqual([]);
    expect(authwallService.getLastRunMetrics().profilesParsed).toBe(0);

    const recruiterService = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => recruiter });
    const results = await recruiterService.discover({ targetRoles: ["React Developer"], skills: ["React"], preferredLocations: ["Bengaluru"] });
    expect(results[0]?.recruiterName).toBe("Jane Doe");
    expect(results[0]?.employer).toBe("Acme Corp");
    expect(recruiterService.getLastRunMetrics().profilesParsed).toBeGreaterThan(0);
  });

  it("accepts role-relevant public evidence and keeps discovered email unverified", async () => {
    const html = `Jane Doe - Technical Recruiter at Acme Corp currently hiring React and frontend engineers <https://linkedin.com/in/jane-doe> jane@example.com`;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React", "TypeScript"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.roleMatchScore).toBeGreaterThan(0);
    expect(results[0]?.email).toBe("jane@example.com");
    expect(results[0]?.emailStatus).toBe("UNVERIFIED");
    expect(results[0]?.discoverySource).toBe("public-web");
    expect(results[0]?.evidenceFreshness).toBe("current");
    expect(service.getLastRunMetrics().profilesFetched).toBeGreaterThan(0);
    expect(service.getLastRunMetrics().profilesParsed).toBeGreaterThan(0);
  });

  it("parses public profile metadata instead of depending on LinkedIn HTML", async () => {
    const search = `Maya Singh — Technical Recruiter at Acme Corp <https://example.com/talent/maya-singh>`;
    const profile = `<html><head><title>Maya Singh | Technical Recruiter | Acme Corp</title><meta name="description" content="Technical Recruiter hiring React and frontend engineers in Bengaluru"><meta property="og:description" content="Recruiting frontend and React engineers"></head><body><h1>Maya Singh</h1><p>Technical Recruiter at Acme Corp. Hiring React engineers in Bengaluru.</p></body></html>`;
    let calls = 0;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async (url) => {
      calls += 1;
      return url.includes("example.com/talent") ? profile : search;
    }});
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"], preferredLocations: ["Bengaluru"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.recruiterName).toBe("Maya Singh");
    expect(results[0]?.employer).toBe("Acme Corp");
    expect(results[0]?.employerDomain).toBeUndefined();
    expect(service.getLastRunMetrics().profilesFetched).toBeGreaterThan(0);
    expect(service.getLastRunMetrics().profilesParsed).toBeGreaterThan(0);
    expect(calls).toBeGreaterThan(9);
  });

  it("accepts public recruiter evidence without requiring LinkedIn", async () => {
    const page = `Sathish A R — Technical Recruiter | Stackforce Bengaluru Karnataka India. Currently hiring for frontend and React roles. Contact sathish@stackforce.co <https://www.stackforce.co/talent/sathish-a-r-technical-recruiter-123>`;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => page });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React", "TypeScript"], preferredLocations: ["Bengaluru"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.discoveryUrl).toContain("stackforce.co/talent");
    expect(results[0]?.email).toBe("sathish@stackforce.co");
    expect(results[0]?.employerDomain).toBe("stackforce.co");
  });

  it("corroborates employer domain when employer text and public email domain agree", async () => {
    const html = `Jane Doe Technical Recruiter at Acme Corp hiring React engineers <https://linkedin.com/in/jane-doe> jane@acme.com`;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results[0]?.employer).toBe("Acme Corp");
    expect(results[0]?.employerDomain).toBe("acme.com");
  });

  it("classifies current, recent, and historical hiring evidence without treating history as current", async () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const pages = [
      "Current Recruiter - Technical Recruiter at Example Corp currently hiring React engineers <https://linkedin.com/in/current-recruiter>",
      "Recent Recruiter - Technical Recruiter at Example Corp 2026 recruiting frontend engineers <https://linkedin.com/in/recent-recruiter>",
      "Historical Recruiter - Technical Recruiter at Example Corp 2023 previously recruited frontend engineers <https://linkedin.com/in/historical-recruiter>"
    ];
    let index = 0;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => pages[index++ % pages.length] ?? null, now: () => now });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results.map((result) => result.evidenceFreshness).sort()).toEqual(["current", "historical", "recent"].sort());
  });

  it("counts actual profile fetches and parses only returned profile evidence", async () => {
    const searchPage = `Search query: site:linkedin.com/in "technical recruiter" "Frontend Engineer" "Bengaluru"\nJane Doe - Recruiter <https://linkedin.com/in/jane-doe>`;
    const profilePage = `<html><head><title>Jane Doe | Technical Recruiter at Acme</title><meta name="description" content="Technical Recruiter at Acme hiring frontend engineers in Bengaluru"></head><body><h1>Jane Doe</h1><p>Technical Recruiter at Acme. Hiring React and frontend engineers.</p></body></html>`;
    const calls: string[] = [];
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async (url) => {
      calls.push(url);
      return url.includes("linkedin.com/in/") ? profilePage : searchPage;
    } });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"], preferredLocations: ["Bengaluru"] });
    const metrics = service.getLastRunMetrics();
    expect(calls.some((url) => url.includes("linkedin.com/in/jane-doe"))).toBe(true);
    expect(metrics.profileFetchAttempts).toBeGreaterThan(0);
    expect(metrics.profilesFetched).toBe(metrics.profileFetchAttempts);
    expect(metrics.profilesParsed).toBeGreaterThan(0);
    expect(results[0]?.recruiterName).toBe("Jane Doe");
  });

  it("does not use query text as role evidence when the fetched profile is generic", async () => {
    const searchPage = `Search query: site:linkedin.com/in "technical recruiter" "Frontend Engineer" "Bengaluru"\nJane Doe - Recruiter <https://linkedin.com/in/jane-doe>`;
    const profilePage = `<html><head><title>Jane Doe | Recruiter</title></head><body><h1>Jane Doe</h1><p>Recruiter at Acme Corp.</p></body></html>`;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async (url) => url.includes("linkedin.com/in/") ? profilePage : searchPage });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"], preferredLocations: ["Bengaluru"] });
    expect(results).toEqual([]);
    expect(service.getLastRunMetrics().rejectionReasons.ROLE_IRRELEVANT).toBeGreaterThan(0);
  });


  it("does not qualify a fetched recruiter profile without public hiring evidence", async () => {
    const search = `site:linkedin.com/in "technical recruiter" "Frontend Engineer" "Bengaluru" Jane Doe <https://linkedin.com/in/jane-doe>`;
    const profile = `<html><head><title>Jane Doe | Technical Recruiter | Acme Corp</title></head><body><h1>Jane Doe</h1><p>Technical Recruiter at Acme Corp.</p></body></html>`;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async (url) => url.includes("linkedin.com/in/") ? profile : search });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"], preferredLocations: ["Bengaluru"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.recruiterName).toBe("Jane Doe");
    expect(results[0]?.hiringEvidenceScore).toBe(0);
    expect(results[0]?.emailStatus).toBe("UNVERIFIED");
    expect(service.getLastRunMetrics().hiringEvidenceAccepted).toBe(0);
    expect(service.getLastRunMetrics().rejectionReasons.HIRING_EVIDENCE_MISSING).toBeGreaterThan(0);
  });

  it("does not qualify a job-page person name as a recruiter profile", async () => {
    const page = `Jane Doe - Technical Recruiter at Acme Corp currently hiring React engineers <https://acme.com/jobs/frontend-engineer>`;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => page });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results).toEqual([]);
    expect(service.getLastRunMetrics().identityValidated).toBe(0);
  });

  it("records profile fetch failures separately from successful profile fetches", async () => {
    const searchPage = `Jane Doe - Recruiter <https://linkedin.com/in/jane-doe>`;
    let profile = false;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async (url) => {
      if (url.includes("linkedin.com/in/")) { profile = true; return null; }
      return searchPage;
    } });
    await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    const metrics = service.getLastRunMetrics();
    expect(profile).toBe(true);
    expect(metrics.profileFetchAttempts).toBeGreaterThan(0);
    expect(metrics.profilesFetched).toBe(0);
    expect(metrics.profilesFetchFailures).toBe(metrics.profileFetchAttempts);
    expect(metrics.profilesParsed).toBe(0);
  });

  it("bounds public recruiter discovery concurrency at four requests globally", async () => {
    let active = 0;
    let peak = 0;
    const html = `Jane Doe - Technical Recruiter currently hiring React and frontend engineers <https://linkedin.com/in/jane-doe> jane@example.com`;
    const fetchText = async (): Promise<string> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return html;
    };
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 3, targetCandidates: 20, fetchText });
    await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("does not discover generic recruiters without target-role evidence", async () => {
    const html = `Jane Doe - Recruiter <https://linkedin.com/in/jane-doe>`;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results).toEqual([]);
    expect(service.getLastRunMetrics().rejectionReasons.ROLE_IRRELEVANT).toBeGreaterThan(0);
  });

  it("keeps duplicate evidence as one canonical recruiter while retaining source evidence", async () => {
    const html = `Jane Doe - Technical Recruiter at Acme Corp currently hiring React engineers <https://linkedin.com/in/jane-doe> jane@acme.com`;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 3, targetCandidates: 20, fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.discoveryEvidence.length).toBeGreaterThan(0);
    expect(service.getLastRunMetrics().duplicates).toBeGreaterThan(0);
  });

  it("fans proactive discovery across expanded public source families", async () => {
    const calls: string[] = [];
    const service = new ProactiveRecruiterDiscoveryService({
      maxQueries: 1,
      fetchText: async (url) => {
        calls.push(url);
        return `Priya Sharma - Technical Recruiter at Acme Corp currently hiring React engineers <https://linkedin.com/in/priya-sharma> priya@acme.com`;
      }
    });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React", "TypeScript"] });
    expect(calls.length).toBeGreaterThanOrEqual(10);
    expect(calls.some((url) => url.includes("google.com"))).toBe(true);
    expect(calls.some((url) => url.includes("bing.com"))).toBe(true);
    expect(calls.some((url) => url.includes("duckduckgo.com"))).toBe(true);
    expect(calls.some((url) => url.includes("startpage.com"))).toBe(true);
    expect(calls.some((url) => url.includes("ecosia.org"))).toBe(true);
    expect(calls.some((url) => url.includes("search.brave.com"))).toBe(true);
    expect(calls.some((url) => url.includes("mojeek.com"))).toBe(true);
    expect(calls.some((url) => url.includes("qwant.com"))).toBe(true);
    expect(calls.some((url) => url.includes("search.yahoo.com"))).toBe(true);
    expect(results).toHaveLength(1);
  });

  it("does not treat a generic mailbox as a recruiter email", async () => {
    const html = `Priya Sharma - Technical Recruiter at Acme Corp currently hiring React engineers <https://linkedin.com/in/priya-sharma> priya@gmail.com`;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"] });
    expect(results[0]?.email).toBeUndefined();
    expect(results[0]?.emailStatus).toBe("UNVERIFIED");
  });

  it("exposes detailed zero-result diagnostics", async () => {
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => null });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"] });
    const metrics = service.getLastRunMetrics();
    expect(results).toEqual([]);
    expect(metrics.queriesGenerated).toBe(1);
    expect(metrics.queriesExecuted).toBeGreaterThanOrEqual(9);
    expect(metrics.queriesFailed).toBe(metrics.queriesExecuted);
    expect(Object.keys(metrics.sourceStats).length).toBeGreaterThanOrEqual(9);
  });
});
