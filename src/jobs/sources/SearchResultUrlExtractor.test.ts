import { extractSearchResultUrls } from "./SearchResultUrlExtractor";

describe("SearchResultUrlExtractor", () => {
  const extract = (input: string, baseUrl?: string) => extractSearchResultUrls(input, baseUrl).urls;

  it("extracts markdown absolute URLs", () => {
    expect(extract("[Frontend Developer](https://example.com/jobs/123)")).toEqual(["https://example.com/jobs/123"]);
  });
  it("extracts multiple markdown URLs", () => {
    expect(extract("[A](https://a.example/jobs/1) [B](https://b.example/careers/2)")).toEqual(["https://a.example/jobs/1", "https://b.example/careers/2"]);
  });
  it("extracts HTML href values including single quotes", () => {
    expect(extract('<a href="https://example.com/jobs/1">A</a><a href=\'https://example.com/jobs/2\'>B</a>')).toEqual(["https://example.com/jobs/1", "https://example.com/jobs/2"]);
  });
  it("resolves relative hrefs against the search page base URL", () => {
    expect(extract('<a href="/jobs/123">React Developer</a>', "https://example.com/search?q=react")).toEqual(["https://example.com/jobs/123"]);
  });
  it("resolves scheme-relative hrefs", () => {
    expect(extract('<a href="//example.com/jobs/123">React Developer</a>', "https://example.com/search")).toEqual(["https://example.com/jobs/123"]);
  });
  it("extracts RSS/XML links", () => {
    expect(extract("<item><link>https://example.com/jobs/123</link></item><link href=\"https://example.com/jobs/456\" />")).toEqual(["https://example.com/jobs/123", "https://example.com/jobs/456"]);
  });
  it("extracts bare HTTPS URLs", () => {
    expect(extract("Result: https://example.com/careers/frontend-engineer")).toEqual(["https://example.com/careers/frontend-engineer"]);
  });
  it("unwraps Google q= redirects", () => {
    expect(extract("https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fjobs%2F123")).toEqual(["https://example.com/jobs/123"]);
  });
  it("unwraps Google url= redirects", () => {
    expect(extract("https://www.google.com/url?url=https%3A%2F%2Fexample.com%2Fjobs%2F123")).toEqual(["https://example.com/jobs/123"]);
  });
  it("rejects Google redirects without a destination", () => {
    expect(extract("https://www.google.com/url?q=")).toEqual([]);
  });
  it("unwraps Bing redirects with url=", () => {
    expect(extract("https://www.bing.com/ck/a?url=https%3A%2F%2Fexample.com%2Fjobs%2F123")).toEqual(["https://example.com/jobs/123"]);
  });
  it("unwraps Bing base64-style u= destinations", () => {
    const encoded = Buffer.from("https://example.com/jobs/123", "utf8").toString("base64url");
    expect(extract(`https://www.bing.com/ck/a?u=a1${encoded}`)).toEqual(["https://example.com/jobs/123"]);
  });
  it("rejects Bing redirects without a destination", () => {
    expect(extract("https://www.bing.com/ck/a?u=")).toEqual([]);
  });
  it("unwraps DuckDuckGo uddg redirects", () => {
    expect(extract("https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fjobs%2F123")).toEqual(["https://example.com/jobs/123"]);
  });
  it("unwraps Jina reader proxy destinations", () => {
    expect(extract("https://r.jina.ai/https://example.com/jobs/123")).toEqual(["https://example.com/jobs/123"]);
  });
  it("rejects Jina search wrappers without a destination", () => {
    expect(extract("https://s.jina.ai/React%20Developer%20Bengaluru")).toEqual([]);
  });
  it("decodes percent-encoded destinations", () => {
    expect(extract("https%3A%2F%2Fexample.com%2Fjobs%2F123")).toEqual(["https://example.com/jobs/123"]);
  });
  it("decodes HTML entities", () => {
    expect(extract("https://example.com/jobs/123?x=1&amp;y=2")).toEqual(["https://example.com/jobs/123?x=1&y=2"]);
  });
  it("decodes XML entities", () => {
    expect(extract("<link>https://example.com/jobs/123?x=1&amp;y=2</link>")).toEqual(["https://example.com/jobs/123?x=1&y=2"]);
  });
  it("handles bounded nested encoding", () => {
    const once = encodeURIComponent("https://example.com/jobs/123");
    const twice = encodeURIComponent(once);
    expect(extract(twice)).toEqual(["https://example.com/jobs/123"]);
  });
  it("deduplicates direct and redirect representations", () => {
    expect(extract("https://example.com/jobs/123 https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fjobs%2F123")).toEqual(["https://example.com/jobs/123"]);
  });
  it("rejects malformed and unsafe protocols", () => {
    expect(extract("not-a-url javascript:alert(1) data:text/plain,hello blob:https://example.com/x file:///tmp/x")).toEqual([]);
  });
  it("rejects localhost and internal URLs", () => {
    expect(extract("https://localhost/jobs/1 https://127.0.0.1/jobs/2 https://0.0.0.0/jobs/3")).toEqual([]);
  });
  it("rejects search engine URLs without recoverable destinations", () => {
    expect(extract("https://www.google.com/search?q=react https://www.bing.com/search?q=react https://duckduckgo.com/?q=react")).toEqual([]);
  });
  it("rejects obvious login/signup/account URLs", () => {
    expect(extract("https://example.com/login https://example.com/signup https://example.com/register https://example.com/account")).toEqual([]);
  });
  it("accepts Greenhouse URLs", () => {
    expect(extract("https://boards.greenhouse.io/example/jobs/123")).toEqual(["https://boards.greenhouse.io/example/jobs/123"]);
  });
  it("accepts Lever URLs", () => {
    expect(extract("https://jobs.lever.co/example/123")).toEqual(["https://jobs.lever.co/example/123"]);
  });
  it("accepts Ashby URLs", () => {
    expect(extract("https://jobs.ashbyhq.com/example/123")).toEqual(["https://jobs.ashbyhq.com/example/123"]);
  });
  it("accepts Workday URLs", () => {
    expect(extract("https://example.wd1.myworkdayjobs.com/en-US/careers/job/123")).toEqual(["https://example.wd1.myworkdayjobs.com/en-US/careers/job/123"]);
  });
  it("accepts unusual company career paths", () => {
    expect(extract("https://careers.example.com/opportunities/view?id=123")).toEqual(["https://careers.example.com/opportunities/view?id=123"]);
  });
  it("preserves meaningful query parameters while removing obvious tracking", () => {
    expect(extract("https://example.com/opening?id=123&team=frontend&utm_source=google#details")).toEqual(["https://example.com/opening?id=123&team=frontend"]);
  });
  it("unwraps a generic tracking wrapper when the destination is explicit", () => {
    expect(extract("https://tracker.example/redirect?url=https%3A%2F%2Fexample.com%2Fjobs%2F123")).toEqual(["https://example.com/jobs/123"]);
  });
  it("rejects a tracking wrapper when its destination is missing", () => {
    expect(extract("https://tracker.example/redirect?url=")).toEqual([]);
  });
  it("supports mixed markdown, HTML, RSS and bare URLs", () => {
    const page = ["[A](https://example.com/jobs/1)", '<a href="https://example.com/jobs/2">B</a>', "<link>https://example.com/jobs/3</link>", "https://example.com/jobs/4"].join(" ");
    const urls = extract(page);
    expect(urls).toHaveLength(4);
    expect(urls).toEqual(expect.arrayContaining(["https://example.com/jobs/1", "https://example.com/jobs/2", "https://example.com/jobs/3", "https://example.com/jobs/4"]));
  });
  it("handles multiple results from one page and keeps different jobs distinct", () => {
    expect(extract("https://example.com/jobs/1 https://example.com/jobs/2 https://example.com/jobs/3")).toHaveLength(3);
  });
  it.each([
    ["Indeed", "https://in.indeed.com/viewjob?jk=abc123"],
    ["Naukri", "https://www.naukri.com/job-listings-react-developer-123"],
    ["Cutshort", "https://cutshort.io/job/react-developer-123"],
    ["Foundit", "https://www.foundit.in/job/react-developer-123"],
    ["LinkedIn", "https://www.linkedin.com/jobs/view/1234567890/"]
  ])("accepts representative %s public job URLs", (_name, url) => {
    expect(extract(url)).toEqual([url]);
  });
  it("reports useful extraction diagnostics", () => {
    const result = extractSearchResultUrls("[A](https://example.com/jobs/1) https://example.com/jobs/1 https://www.google.com/search?q=react");
    expect(result.diagnostics.markdownCandidates).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.bareUrlCandidates).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.redirectCandidates).toBe(0);
    expect(result.diagnostics.normalizedUrls).toBe(1);
    expect(result.diagnostics.duplicates).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.rejectedCandidates).toBeGreaterThanOrEqual(1);
  });
});
