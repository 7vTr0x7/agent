import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";

const domainResolver = async (company: string): Promise<string | null> => `${company.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`;

function serviceWithHtml(html: string, now?: Date) {
  return new ProactiveRecruiterDiscoveryService({
    fetchText: async () => html,
    resolveEmployerDomain: domainResolver,
    ...(now ? { now: () => now } : {})
  });
}

describe("ProactiveRecruiterDiscoveryService", () => {
  it("builds deterministic role-specific location-aware recruiter searches without a giant OR expression", () => {
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => null });
    const queries = service.buildQueries({
      targetRoles: ["Frontend Engineer", "React Developer", "Next.js Developer"],
      skills: ["React", "TypeScript", "Node.js"]
    });
    expect(queries.length).toBeGreaterThanOrEqual(8);
    expect(queries.some((query) => query.includes("frontend engineer"))).toBe(true);
    expect(queries.some((query) => query.includes("react developer"))).toBe(true);
    expect(queries.some((query) => query.includes("bengaluru"))).toBe(true);
    expect(queries.some((query) => query.includes("india"))).toBe(true);
    expect(queries.every((query) => !query.includes(" OR "))).toBe(true);
    expect(queries.every((query) => !query.includes("node.js"))).toBe(true);
  });

  it("parses Name - Recruiter evidence and keeps discovered email unverified", async () => {
    const service = serviceWithHtml(`Jane Doe - Technical Recruiter at Acme hiring React engineers | LinkedIn <https://linkedin.com/in/jane-doe> jane@acme.com`);
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React", "TypeScript"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.recruiterName).toBe("Jane Doe");
    expect(results[0]?.roleMatchScore).toBeGreaterThan(0);
    expect(results[0]?.email).toBe("jane@acme.com");
    expect(results[0]?.emailStatus).toBe("UNVERIFIED");
    expect(results[0]?.employer).toBe("Acme");
    expect(results[0]?.employerDomain).toBe("acme.example");
  });

  it("parses Name - Company | LinkedIn evidence without requiring an email", async () => {
    const service = serviceWithHtml(`Jane Doe - Acme Corp | LinkedIn technical recruiter hiring React Developer <https://linkedin.com/in/jane-doe>`);
    const results = await service.discover({ targetRoles: ["React Developer"], skills: ["React"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.recruiterName).toBe("Jane Doe");
    expect(results[0]?.employer).toBe("Acme Corp");
    expect(results[0]?.employerDomain).toBe("acmecorp.example");
    expect(results[0]?.email).toBeUndefined();
  });

  it("parses Name | LinkedIn evidence when recruiting context follows the profile heading", async () => {
    const service = serviceWithHtml(`Aisha Khan | LinkedIn at Bright Labs technical recruiter recruiting Frontend Engineer and React Developer <https://linkedin.com/in/aisha-khan>`);
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.recruiterName).toBe("Aisha Khan");
    expect(results[0]?.employer).toBe("Bright Labs");
  });

  it("does not accept malformed or non-recruiter evidence as recruiter identity", async () => {
    const service = serviceWithHtml(`Jane Doe - Software Engineer | LinkedIn <https://linkedin.com/in/jane-doe>`);
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results).toEqual([]);
  });

  it("classifies current, recent, and historical hiring evidence without treating history as current", async () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const pages = [
      "Current Recruiter - Acme | LinkedIn technical recruiter actively hiring React engineers <https://linkedin.com/in/current-recruiter>",
      "Recent Recruiter - Beta | LinkedIn technical recruiter 2026 recruiting frontend engineers <https://linkedin.com/in/recent-recruiter>",
      "Historical Recruiter - Gamma | LinkedIn technical recruiter 2023 previously recruited frontend engineers <https://linkedin.com/in/historical-recruiter>"
    ];
    let index = 0;
    const service = new ProactiveRecruiterDiscoveryService({
      fetchText: async () => pages[index++ % pages.length] ?? null,
      now: () => now,
      resolveEmployerDomain: domainResolver
    });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results.map((result) => result.evidenceFreshness).sort()).toEqual(["current", "historical", "recent"].sort());
  });
});
