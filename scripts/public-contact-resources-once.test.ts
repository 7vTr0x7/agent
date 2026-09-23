import { extractEmails, isPrivateAddress, relevance, urlsFromSearch, qualifiesJobPageAsContactResource } from "./public-contact-resources-once";

describe("public contact resource extraction", () => {
  it("normalizes discovered emails and excludes generic machine mailboxes", () => {
    expect(extractEmails("Hiring contact: Recruiter@Example.com recruiter@EXAMPLE.com noreply@example.com support@example.com"))
      .toEqual(["recruiter@example.com"]);
  });

  it("requires relevant professional context before qualifying a contact", () => {
    expect(relevance("person@example.com","Frontend React developer hiring contact — send your resume",["React","Next.js"])).toBeGreaterThanOrEqual(60);
    expect(relevance("person@example.com","privacy policy and newsletter subscription",["React","Next.js"])).toBeLessThan(60);
  });

  it("does not qualify a plain company directory without hiring evidence", () => {
    expect(relevance("person@example.com", "Company directory and generic contact information", ["React", "Next.js"])).toBeLessThan(60);
    expect(relevance("person@example.com", "We are hiring a React developer — send your resume to this recruiting contact", ["React", "Next.js"])).toBeGreaterThanOrEqual(60);
  });

  it("removes search-result punctuation instead of fetching quoted URLs", () => {
    expect(urlsFromSearch('https://example.com/careers" https://example.com/jobs, https://example.com/team)'))
      .toEqual(["https://example.com/careers","https://example.com/jobs","https://example.com/team"]);
  });

  it("does not turn embedded Schema.org JSON into a resource URL", () => {
    const noisy = 'https://remotefirstjobs.com/companies/example/jobs/frontend%22,%22email%22:%22careers@example.com%22,%22logo%22:%22https://example.com/logo.png%22';
    const noisySuffix = 'https://remotefirstjobs.com/companies/example/jobs/frontend%22%7D';
    expect(urlsFromSearch(noisy)).toEqual(["https://remotefirstjobs.com/companies/example/jobs/frontend"]);
    expect(urlsFromSearch(noisySuffix)).toEqual(["https://remotefirstjobs.com/companies/example/jobs/frontend"]);
  });

  it("rejects known blocked job-board hosts while preserving unrelated domains", () => {
    expect(urlsFromSearch("https://www.simplyhired.com/jobs https://foo.simplyhired.com/careers https://www.joblist.com https://www.snagajob.com https://example.com/careers"))
      .toEqual(["https://example.com/careers"]);
  });

  it("extracts hiring emails from HTML structured data and mailto links", () => {
    expect(qualifiesJobPageAsContactResource(
      "https://example.com/jobs/frontend-developer",
      `<html><head><script type="application/ld+json">{"@type":"JobPosting","hiringOrganization":{"email":"jobs@example.com"}}</script></head><body><a href="mailto:careers@example.com">Apply</a><p>We are hiring a React developer.</p></body></html>`,
      ["React", "Next.js"]
    )).toBe(true);
  });

  it("accepts a matched job page when it directly publishes a relevant hiring email", () => {
    expect(qualifiesJobPageAsContactResource(
      "https://example.com/jobs/frontend-developer",
      "Frontend Developer — Bengaluru. We are hiring a React developer. Send your resume to careers@example.com.",
      ["React", "Next.js"]
    )).toBe(true);
  });

  it("does not accept a matched job page with an unrelated support email", () => {
    expect(qualifiesJobPageAsContactResource(
      "https://example.com/jobs/frontend-developer",
      "Frontend Developer — Bengaluru. We are hiring a React developer. For account support contact support@example.com.",
      ["React", "Next.js"]
    )).toBe(false);
  });

  it("does not treat search infrastructure as a public resource", () => {
    expect(urlsFromSearch('https://www.qwant.com/?q=frontend https://api.qwant.com/v3 https://about.qwant.com/en/" https://example.com/careers'))
      .toEqual(["https://example.com/careers"]);
  });

  it("blocks private and non-routable fetch addresses", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.0.0.8")).toBe(true);
    expect(isPrivateAddress("192.168.1.10")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("rejects non-http resource URLs", () => {
    expect(urlsFromSearch("ftp://example.com/contacts https://example.com/careers")).toEqual(["https://example.com/careers"]);
  });
});
