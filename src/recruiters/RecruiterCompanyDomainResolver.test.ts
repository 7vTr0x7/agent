import {
  resolveEmployerDomainFromJobData,
  resolveEmployerDomainFromJobUrl,
  resolveEmployerDomainFromTrustedJobSource
} from "./RecruiterCompanyDomainResolver";

describe("RecruiterCompanyDomainResolver", () => {
  it("normalizes a direct employer URL", () => {
    expect(resolveEmployerDomainFromJobUrl("https://careers.example.com/jobs/frontend"))
      .toBe("example.com");
  });

  it("rejects marketplace and ATS URLs", () => {
    expect(resolveEmployerDomainFromJobUrl("https://www.naukri.com/job-listings/frontend-engineer"))
      .toBeNull();
    expect(resolveEmployerDomainFromJobUrl("https://boards.greenhouse.io/example/jobs/123"))
      .toBeNull();
  });

  it("rejects free/public job feed domains as employer identity", () => {
    for (const host of [
      "https://weworkremotely.com/remote-jobs/frontend",
      "https://remoteok.com/remote-jobs/123",
      "https://himalayas.app/jobs/frontend-engineer",
      "https://jobicy.com/jobs/frontend-engineer",
      "https://arbeitnow.com/view/frontend-engineer",
      "https://remotefirstjobs.com/job/frontend-engineer",
      "https://remoteyeah.com/jobs/frontend-engineer",
      "https://realworkfromanywhere.com/remote-frontend-jobs/example",
      "https://hireweb3.io/jobs/frontend"
    ]) {
      expect(resolveEmployerDomainFromJobUrl(host)).toBeNull();
    }
  });

  it("rejects invalid URLs", () => {
    expect(resolveEmployerDomainFromJobUrl("not a valid url"))
      .toBeNull();
  });

  it("does not trust a recruiter email in the job description as employer identity", () => {
    expect(resolveEmployerDomainFromJobData(
      "boards.greenhouse.io",
      "https://boards.greenhouse.io/example/jobs/123",
      "Recruiter: hiring@example.com"
    )).toBeNull();
  });

  it("does not trust an arbitrary employer-looking link in the job description", () => {
    expect(resolveEmployerDomainFromJobData(
      null,
      "https://weworkremotely.com/remote-jobs/example",
      "Apply on https://careers.example.com/jobs/frontend"
    )).toBeNull();
  });

  it("uses a direct canonical employer URL when company_domain is missing", () => {
    expect(resolveEmployerDomainFromJobData(
      null,
      "https://careers.example.com/jobs/frontend",
      ""
    )).toBe("example.com");
  });

  it("does not use a blocked canonical job-feed URL as employer evidence", () => {
    expect(resolveEmployerDomainFromJobData(
      null,
      "https://remoteok.com/remote-jobs/frontend",
      ""
    )).toBeNull();
  });

  it("accepts a company-matching recruiting email from a job description", () => {
    expect(resolveEmployerDomainFromJobData(
      null,
      "https://himalayas.app/companies/particle41/jobs/frontend-developer",
      "Apply by contacting careers@particle41.com.",
      "Particle41"
    )).toBe("particle41.com");
  });

  it("rejects an unrelated job-description domain", () => {
    expect(resolveEmployerDomainFromJobData(
      null,
      "https://himalayas.app/companies/particle41/jobs/frontend-developer",
      "Apply through https://example.com/careers or recruiter@gmail.com.",
      "Particle41"
    )).toBeNull();
  });

  it("accepts a configured bare employer domain", () => {
    expect(resolveEmployerDomainFromJobData(
      "example.com",
      "https://weworkremotely.com/remote-jobs/example",
      ""
    )).toBe("example.com");
  });

  it("rejects generic personal email domains as employer evidence", () => {
    expect(resolveEmployerDomainFromJobData(
      null,
      "https://weworkremotely.com/remote-jobs/example",
      "Contact recruiter@gmail.com for details"
    )).toBeNull();
  });

  it("resolves a company domain from a trusted Himalayas company profile", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => new Response('<a href="https://particle41.com/">Visit particle41.com</a><a href="https://www.linkedin.com/company/particle41">LinkedIn</a>')) as typeof fetch;
    try {
      await expect(resolveEmployerDomainFromTrustedJobSource(
        "https://himalayas.app/companies/particle41/jobs/frontend-developer",
        "Particle41"
      )).resolves.toBe("particle41.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resolves an escaped company website from a trusted Himalayas profile", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => new Response('<script>window.__DATA__={\"website\":\"https:\\/\\/www.particle41.com\"}</script>')) as typeof fetch;
    try {
      await expect(resolveEmployerDomainFromTrustedJobSource(
        "https://himalayas.app/companies/particle41/jobs/frontend-developer",
        "Particle41"
      )).resolves.toBe("particle41.com");
    } finally { globalThis.fetch = originalFetch; }
  });

  it("rejects a job feed company domain even when the canonical URL is the same feed", () => {
    expect(resolveEmployerDomainFromJobData(
      "remoteok.com",
      "https://remoteok.com/remote-jobs/frontend",
      ""
    )).toBeNull();
  });


  it("accepts a single public search result when the fetched site independently identifies the employer", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("google.com/search")) {
        return new Response('<a href="https://www.piplnow.com/">PiplNow</a>', { status: 200 });
      }
      if (url.includes("piplnow.com")) {
        return new Response("<html><title>PiplNow LLC</title><body>Discover Talent with PiplNow</body></html>", { status: 200 });
      }
      return new Response("", { status: 503 });
    }) as typeof fetch;
    try {
      await expect(resolveEmployerDomainFromPublicSearch("PiplNow LLC")).resolves.toBe("piplnow.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not accept a single search result when the fetched site does not corroborate the employer", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("google.com/search")) {
        return new Response('<a href="https://example.com/">Example</a>', { status: 200 });
      }
      if (url.includes("example.com")) {
        return new Response("<html><title>Unrelated Site</title></html>", { status: 200 });
      }
      return new Response("", { status: 503 });
    }) as typeof fetch;
    try {
      await expect(resolveEmployerDomainFromPublicSearch("PiplNow LLC")).resolves.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
