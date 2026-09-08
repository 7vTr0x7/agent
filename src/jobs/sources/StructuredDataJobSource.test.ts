import { StructuredDataJobSource } from "./StructuredDataJobSource";

describe("StructuredDataJobSource", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("extracts JobPosting JSON-LD from a public page", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `<html><script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Frontend Engineer",
        description: "Build React applications.",
        url: "https://example.com/jobs/frontend-engineer",
        datePosted: "2026-09-08",
        hiringOrganization: { name: "Example Corp" },
        jobLocation: { address: { addressLocality: "Bengaluru", addressCountry: "India" } },
        employmentType: "FULL_TIME"
      })}</script></html>`
    }) as typeof fetch;

    const jobs = await new StructuredDataJobSource({
      id: "example:web",
      url: "https://example.com/jobs",
      companyDomain: "example.com"
    }).fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "example:web",
      title: "Frontend Engineer",
      companyName: "Example Corp",
      location: "Bengaluru, India",
      country: "India",
      employmentType: "FULL_TIME"
    });
    expect(jobs[0].contentHash).toHaveLength(64);
  });

  it("supports @graph and ignores malformed/non-job JSON-LD", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `<script type="application/ld+json">not-json</script><script type="application/ld+json">${JSON.stringify({
        "@graph": [
          { "@type": "Organization", name: "Example" },
          { "@type": "JobPosting", title: "React Developer", description: "React role", hiringOrganization: { name: "Example" } }
        ]
      })}</script>`
    }) as typeof fetch;

    const jobs = await new StructuredDataJobSource({ id: "example", url: "https://example.com" }).fetchJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe("React Developer");
  });

  it("fails clearly on a non-success response", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as typeof fetch;
    await expect(new StructuredDataJobSource({ id: "blocked", url: "https://example.com" }).fetchJobs())
      .rejects.toThrow("HTTP 403");
  });
});
