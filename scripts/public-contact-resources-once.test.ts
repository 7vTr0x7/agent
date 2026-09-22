import { extractEmails, relevance, urlsFromSearch } from "./public-contact-resources-once";

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

  it("does not treat search infrastructure as a public resource", () => {
    expect(urlsFromSearch('https://www.qwant.com/?q=frontend https://api.qwant.com/v3 https://about.qwant.com/en/" https://example.com/careers'))
      .toEqual(["https://example.com/careers"]);
  });
});
