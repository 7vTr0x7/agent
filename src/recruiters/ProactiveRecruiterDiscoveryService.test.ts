import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";

describe("ProactiveRecruiterDiscoveryService", () => {
  it("builds recruiter searches from candidate roles and skills without requiring a job", () => {
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => null });
    const queries = service.buildQueries({ targetRoles: ["Frontend Engineer"], skills: ["React", "TypeScript"] });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]).toContain("frontend engineer");
    expect(queries[0]).toContain("react");
  });

  it("accepts role-relevant public evidence and keeps discovered email unverified", async () => {
    const html = `Jane Doe - Technical Recruiter hiring React and frontend engineers <https://linkedin.com/in/jane-doe> jane@example.com`;
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React", "TypeScript"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.roleMatchScore).toBeGreaterThan(0);
    expect(results[0]?.email).toBe("jane@example.com");
    expect(results[0]?.emailStatus).toBe("UNVERIFIED");
    expect(results[0]?.discoverySource).toBe("public-web");
    expect(results[0]?.evidenceFreshness).toBe("unknown");
  });

  it("corroborates employer domain only when employer text and public email domain agree", async () => {
    const html = `Jane Doe Technical Recruiter at Acme Corp hiring React engineers <https://linkedin.com/in/jane-doe> jane@acme.com`;
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results[0]?.employer).toBe("Acme Corp");
    expect(results[0]?.employerDomain).toBe("acme.com");
  });

  it("classifies current, recent, and historical hiring evidence without treating history as current", async () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const pages = [
      "Current Recruiter actively hiring React engineers <https://linkedin.com/in/current-recruiter>",
      "Recent Recruiter 2026 recruiting frontend engineers <https://linkedin.com/in/recent-recruiter>",
      "Historical Recruiter 2023 previously recruited frontend engineers <https://linkedin.com/in/historical-recruiter>"
    ];
    let index = 0;
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => pages[index++ % pages.length] ?? null, now: () => now });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results.map((result) => result.evidenceFreshness).sort()).toEqual(["current", "historical", "recent"].sort());
  });

  it("bounds public recruiter discovery concurrency at four requests", async () => {
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
    const service = new ProactiveRecruiterDiscoveryService({ fetchText });
    await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("does not discover generic recruiters without target-role evidence", async () => {
    const html = `Jane Doe - Recruiter <https://linkedin.com/in/jane-doe>`;
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results).toEqual([]);
  });

  it("fans proactive discovery across the same expanded public source families", async () => {
    const calls: string[] = [];
    const service = new ProactiveRecruiterDiscoveryService({
      maxQueries: 1,
      fetchText: async (url) => {
        calls.push(url);
        return `Priya Sharma - Technical Recruiter hiring React engineers <https://linkedin.com/in/priya-sharma>`;
      }
    });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React", "TypeScript"] });
    expect(calls).toHaveLength(5);
    expect(calls.some((url) => url.includes("google.com"))).toBe(true);
    expect(calls.some((url) => url.includes("bing.com"))).toBe(true);
    expect(calls.some((url) => url.includes("duckduckgo.com"))).toBe(true);
    expect(calls.some((url) => url.includes("startpage.com"))).toBe(true);
    expect(calls.some((url) => url.includes("ecosia.org"))).toBe(true);
    expect(results).toHaveLength(1);
  });

  it("does not treat a generic mailbox as a recruiter email", async () => {
    const html = `Priya Sharma - Technical Recruiter hiring React engineers <https://linkedin.com/in/priya-sharma> priya@gmail.com`;
    const service = new ProactiveRecruiterDiscoveryService({ maxQueries: 1, fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"] });
    expect(results[0]?.email).toBeUndefined();
    expect(results[0]?.emailStatus).toBe("UNVERIFIED");
  });
});
