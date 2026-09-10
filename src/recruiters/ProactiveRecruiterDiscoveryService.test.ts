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

  it("does not discover generic recruiters without target-role evidence", async () => {
    const html = `Jane Doe - Recruiter <https://linkedin.com/in/jane-doe>`;
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results).toEqual([]);
  });
});
