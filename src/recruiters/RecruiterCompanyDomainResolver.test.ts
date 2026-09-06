import { resolveEmployerDomainFromJobUrl } from "./RecruiterCompanyDomainResolver";

describe("resolveEmployerDomainFromJobUrl", () => {
  it("resolves a direct employer URL", () => {
    expect(resolveEmployerDomainFromJobUrl("https://careers.acme.com/jobs/frontend")).toBe("careers.acme.com");
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
