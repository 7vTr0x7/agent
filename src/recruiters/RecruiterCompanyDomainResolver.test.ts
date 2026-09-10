import {
  resolveEmployerDomainFromJobData,
  resolveEmployerDomainFromJobUrl
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

  it("rejects a job feed company domain even when the canonical URL is the same feed", () => {
    expect(resolveEmployerDomainFromJobData(
      "remoteok.com",
      "https://remoteok.com/remote-jobs/frontend",
      ""
    )).toBeNull();
  });
});
