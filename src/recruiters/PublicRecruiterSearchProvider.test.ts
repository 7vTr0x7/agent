import { promises as dns } from "node:dns";
import { PublicRecruiterSearchProvider, isPlausibleRecruiterEmail } from "./PublicRecruiterSearchProvider";

describe("PublicRecruiterSearchProvider", () => {
  it("rejects search-engine artifacts and malformed recruiter addresses", () => {
    expect(isPlausibleRecruiterEmail("22@accenture.com")).toBe(false);
    expect(isPlausibleRecruiterEmail("%22accenture%22%20@accenture.com")).toBe(false);
    expect(isPlausibleRecruiterEmail(".recruiter@accenture.com")).toBe(false);
    expect(isPlausibleRecruiterEmail("recruiter..name@accenture.com")).toBe(false);
    expect(isPlausibleRecruiterEmail("keri.williams@accenture.com")).toBe(true);
  });

  it("accepts an explicitly recruiting mailbox even when the search snippet omits recruiting keywords", async () => {
    const provider = new PublicRecruiterSearchProvider({ maxQueries: 1, fetchText: async () => "Acme Corp careers result: recruiting@acme.com" });
    const result = await provider.discover({ companyName: "Acme Corp", companyDomain: "acme.com", jobTitle: "Frontend Developer", jobDescription: "", candidateProfileId: "candidate-1" });
    expect(result.contacts.map((contact) => contact.email)).toContain("recruiting@acme.com");
    expect(result.contacts[0]?.confidence).toBeGreaterThanOrEqual(94);
    expect(result.contacts[0]?.verified).toBe(false);
    expect(result.metrics?.queriesGenerated).toBe(1);
  });

  it("discovers identity-only recruiter candidates from public LinkedIn evidence", async () => {
    const provider = new PublicRecruiterSearchProvider({ maxQueries: 1, fetchText: async () => "Priya Sharma - Talent Acquisition Partner | LinkedIn https://www.linkedin.com/in/priya-sharma" });
    const result = await provider.discover({ companyName: "Acme Corp", companyDomain: "acme.com", jobTitle: "Frontend Developer", jobDescription: "React and TypeScript", location: "Bengaluru", candidateProfileId: "candidate-1" });
    expect(result.contacts).toEqual(expect.arrayContaining([expect.objectContaining({ fullName: "Priya Sharma", title: "Talent Acquisition Partner", linkedinProfileUrl: "https://www.linkedin.com/in/priya-sharma", verified: false })]));
    expect(result.metrics?.linkedinUrls).toBeGreaterThan(0);
    expect(result.metrics?.recruiterCandidates).toBeGreaterThan(0);
  });

  it("uses a bounded, diversified source pool and records per-source metrics", async () => {
    let active = 0;
    let peak = 0;
    const calls: string[] = [];
    const provider = new PublicRecruiterSearchProvider({ maxQueries: 1, fetchText: async (url) => { calls.push(url); active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 2)); active -= 1; return "Priya Sharma - Technical Recruiter | LinkedIn https://www.linkedin.com/in/priya-sharma"; } });
    const result = await provider.discover({ companyName: "Acme Corp", companyDomain: "acme.com", jobTitle: "Frontend Developer", jobDescription: "React", candidateProfileId: "candidate-1" });
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(peak).toBeLessThanOrEqual(4);
    expect(Object.keys(result.metrics?.sourceStats ?? {})).toEqual(expect.arrayContaining(["google-jina", "bing-jina", "duckduckgo-jina", "startpage-jina", "ecosia-jina"]));
    if (process.env.JINA_API_KEY?.trim()) expect(Object.keys(result.metrics?.sourceStats ?? {})).toContain("jina-search");
    expect(Object.values(result.metrics?.sourceStats ?? {}).every((stats) => stats.attempted <= 1)).toBe(true);
  });

  it("does not enable credentialed search sources when their credentials are absent", async () => {
    const originalBrave = process.env.BRAVE_SEARCH_API_KEY;
    const originalMojeek = process.env.MOJEEK_API_KEY;
    const originalJina = process.env.JINA_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.MOJEEK_API_KEY;
    delete process.env.JINA_API_KEY;
    try {
      const provider = new PublicRecruiterSearchProvider({ maxQueries: 1, fetchText: async () => "Priya Sharma - Technical Recruiter | LinkedIn https://www.linkedin.com/in/priya-sharma" });
      const result = await provider.discover({ companyName: "Acme Corp", companyDomain: "acme.com", jobTitle: "Frontend Developer", jobDescription: "React", candidateProfileId: "candidate-1" });
      expect(Object.keys(result.metrics?.sourceStats ?? {})).not.toEqual(expect.arrayContaining(["brave-api", "mojeek-api", "jina-search"]));
    } finally {
      if (originalBrave === undefined) delete process.env.BRAVE_SEARCH_API_KEY; else process.env.BRAVE_SEARCH_API_KEY = originalBrave;
      if (originalMojeek === undefined) delete process.env.MOJEEK_API_KEY; else process.env.MOJEEK_API_KEY = originalMojeek;
      if (originalJina === undefined) delete process.env.JINA_API_KEY; else process.env.JINA_API_KEY = originalJina;
    }
  });

  it("deduplicates the same LinkedIn identity across independent sources", async () => {
    const provider = new PublicRecruiterSearchProvider({ maxQueries: 2, fetchText: async () => "Priya Sharma - Talent Acquisition Partner | LinkedIn https://www.linkedin.com/in/priya-sharma" });
    const result = await provider.discover({ companyName: "Acme Corp", companyDomain: "acme.com", jobTitle: "Frontend Developer", jobDescription: "React", candidateProfileId: "candidate-1" });
    const priya = result.contacts.filter((contact) => contact.linkedinProfileUrl === "https://www.linkedin.com/in/priya-sharma");
    expect(priya).toHaveLength(1);
    expect(result.metrics?.duplicateCandidates).toBeGreaterThan(0);
  });

  it("marks an MX-backed recruiter email as LIKELY, not mailbox VERIFIED", async () => {
    const resolveMx = jest.spyOn(dns, "resolveMx").mockResolvedValue([{ exchange: "mail.accenture.com", priority: 10 }]);
    try {
      const provider = new PublicRecruiterSearchProvider();
      await expect(provider.verify("keri.williams@accenture.com")).resolves.toEqual(expect.objectContaining({ email: "keri.williams@accenture.com", verified: false, status: "LIKELY", confidence: 75 }));
      expect(resolveMx).toHaveBeenCalledWith("accenture.com");
    } finally { resolveMx.mockRestore(); }
  });

  it("marks an address INVALID when the employer domain has no MX records", async () => {
    const resolveMx = jest.spyOn(dns, "resolveMx").mockResolvedValue([]);
    try {
      const provider = new PublicRecruiterSearchProvider();
      await expect(provider.verify("recruiter@example.com")).resolves.toEqual({ email: "recruiter@example.com", verified: false, status: "INVALID", confidence: 0 });
    } finally { resolveMx.mockRestore(); }
  });

  it("falls back to DNS-over-HTTPS without upgrading MX evidence to mailbox verification", async () => {
    const resolveMx = jest.spyOn(dns, "resolveMx").mockRejectedValue(new Error("EAI_AGAIN"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("cloudflare-dns.com")) return new Response(JSON.stringify({ Answer: [{ type: 15, data: "10 mail.example.com." }] }), { status: 200, headers: { "content-type": "application/dns-json" } });
      return new Response(JSON.stringify({ Answer: [] }), { status: 200 });
    }) as typeof fetch;
    try {
      const provider = new PublicRecruiterSearchProvider();
      await expect(provider.verify("recruiter@example.com")).resolves.toEqual(expect.objectContaining({ email: "recruiter@example.com", verified: false, status: "LIKELY", confidence: 75 }));
    } finally { resolveMx.mockRestore(); globalThis.fetch = originalFetch; }
  });
});
