import { extractEmails, isPrivateAddress, relevance, urlsFromSearch } from "./public-contact-resources-once";

describe("public contact resource extraction", () => {
  it("normalizes discovered emails and excludes generic machine mailboxes", () => {
    expect(extractEmails("Hiring contact: Recruiter@Example.com recruiter@EXAMPLE.com noreply@example.com support@example.com"))
      .toEqual(["recruiter@example.com"]);
  });

  it("requires relevant professional context before qualifying a contact", () => {
    expect(relevance("person@example.com","Frontend React developer hiring contact — send your resume",["React","Next.js"])).toBeGreaterThanOrEqual(60);
    expect(relevance("person@example.com","privacy policy and newsletter subscription",["React","Next.js"])).toBeLessThan(60);
  });

  it("removes search-result punctuation instead of fetching quoted URLs", () => {
    expect(urlsFromSearch('https://example.com/careers" https://example.com/jobs, https://example.com/team)'))
      .toEqual(["https://example.com/careers","https://example.com/jobs","https://example.com/team"]);
  });

  it("rejects known blocked job-board hosts while preserving unrelated domains", () => {
    expect(urlsFromSearch("https://www.simplyhired.com/jobs https://foo.simplyhired.com/careers https://www.joblist.com https://www.snagajob.com https://example.com/careers"))
      .toEqual(["https://example.com/careers"]);
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

  it("accepts public GitHub contact-resource URLs for open career datasets", () => {
    expect(urlsFromSearch("https://raw.githubusercontent.com/byborh/careerLauncher/main/data/companies.md https://github.com/search?q=careers")).toEqual(["https://raw.githubusercontent.com/byborh/careerLauncher/main/data/companies.md"]);
  });
