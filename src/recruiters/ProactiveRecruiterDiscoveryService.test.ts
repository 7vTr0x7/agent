import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";

describe("ProactiveRecruiterDiscoveryService", () => {
  it("builds deterministic recruiter searches from candidate roles and skills without requiring a job", () => {
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => null });
    const queries = service.buildQueries({ targetRoles: ["Frontend Engineer"], skills: ["React", "TypeScript"], preferredLocations: ["Bengaluru", "India"] });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]).toContain("frontend engineer");
    expect(queries[0]).toContain("Bengaluru");
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("accepts role-relevant public evidence and keeps discovered email unverified", async () => {
    const html = `Jane Doe - Technical Recruiter at Acme Corp hiring React and frontend engineers <https://linkedin.com/in/jane-doe> jane@example.com`;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React", "TypeScript"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.roleMatchScore).toBeGreaterThan(0);
    expect(results[0]?.email).toBe("jane@example.com");
    expect(results[0]?.emailStatus).toBe("UNVERIFIED");
    expect(results[0]?.discoverySource).toBe("public-web");
    expect(results[0]?.evidenceFreshness).toBe("current");
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
      "Current Recruiter - Technical Recruiter actively hiring React engineers <https://linkedin.com/in/current-recruiter>",
      "Recent Recruiter - Technical Recruiter 2026 recruiting frontend engineers <https://linkedin.com/in/recent-recruiter>",
      "Historical Recruiter - Technical Recruiter 2023 previously recruited frontend engineers <https://linkedin.com/in/historical-recruiter>"
    ];
    let index = 0;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => pages[index++ % pages.length] ?? null, now: () => now });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results.map((result) => result.evidenceFreshness).sort()).toEqual(["current", "historical", "recent"].sort());
  });

  it("bounds public recruiter discovery concurrency at four requests globally", async () => {
    let active = 0;
    let peak = 0;
    const html = `Jane Doe - Technical Recruiter hiring React and frontend engineers <https://linkedin.com/in/jane-doe> jane@example.com`;
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
    expect(service.getLastRunMetrics().rejectionReasons.REJECT_ROLE_MISMATCH).toBeGreaterThan(0);
  });

  it("keeps duplicate evidence as one canonical recruiter while retaining source evidence", async () => {
    const html = `Jane Doe - Technical Recruiter at Acme Corp hiring React engineers <https://linkedin.com/in/jane-doe> jane@acme.com`;
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
        return `Priya Sharma - Technical Recruiter at Acme Corp hiring React engineers <https://linkedin.com/in/priya-sharma> priya@acme.com`;
      }
    });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React", "TypeScript"] });
    expect(calls.length).toBeGreaterThanOrEqual(9);
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
    const html = `Priya Sharma - Technical Recruiter at Acme Corp hiring React engineers <https://linkedin.com/in/priya-sharma> priya@gmail.com`;
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
