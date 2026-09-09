import {
  resolveEmployerDomainFromJobData,
  resolveEmployerDomainFromJobUrl
} from "./RecruiterCompanyDomainResolver";

describe("resolveEmployerDomainFromJobUrl", () => {
  it("resolves and normalizes a direct employer URL or bare domain", () => {
    expect(resolveEmployerDomainFromJobUrl("https://careers.acme.com/jobs/frontend")).toBe("acme.com");
    expect(resolveEmployerDomainFromJobUrl("https://jobs.acme.co.in/frontend")).toBe("acme.co.in");
    expect(resolveEmployerDomainFromJobUrl("acme.com")).toBe("acme.com");
  });

  it("does not mistake marketplace or ATS hosts for employers", () => {
    expect(resolveEmployerDomainFromJobUrl("https://www.naukri.com/job-listings/frontend-acme")).toBeNull();
    expect(resolveEmployerDomainFromJobUrl("https://boards.greenhouse.io/acme/jobs/123")).toBeNull();
  });

  it("fails closed for invalid URLs", () => {
    expect(resolveEmployerDomainFromJobUrl("not-a-url")).toBeNull();
    expect(resolveEmployerDomainFromJobUrl("http://localhost:3000/jobs/1")).toBeNull();
  });
});

describe("resolveEmployerDomainFromJobData", () => {
  it("prefers an employer email domain from the job description over an ATS URL", () => {
    expect(
      resolveEmployerDomainFromJobData(
        null,
        "https://boards.greenhouse.io/acme/jobs/123",
        "For recruiting questions contact talent@acme.co.in."
      )
    ).toBe("acme.co.in");
  });

  it("uses an employer link embedded in the job description", () => {
    expect(
      resolveEmployerDomainFromJobData(
        null,
        "https://weworkremotely.com/remote-jobs/example",
        "Company website: https://www.example-company.com/careers"
      )
    ).toBe("example-company.com");
  });

  it("accepts a configured bare employer domain", () => {
    expect(
      resolveEmployerDomainFromJobData(
        "acme.co.in",
        "https://boards.greenhouse.io/acme/jobs/123",
        ""
      )
    ).toBe("acme.co.in");
  });

  it("rejects generic personal email domains as employer evidence", () => {
    expect(
      resolveEmployerDomainFromJobData(
        null,
        "https://weworkremotely.com/remote-jobs/example",
        "Recruiting contact: recruiter@gmail.com"
      )
    ).toBeNull();
  });
});
