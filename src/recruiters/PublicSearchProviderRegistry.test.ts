import { sourceList } from "./PublicSearchProviderRegistry";

describe("PublicSearchProviderRegistry", () => {
  it("includes direct public Google and Bing sources alongside existing providers", () => {
    const ids = sourceList('"Frontend Developer" hiring React').map(source => source.id);
    expect(ids).toContain("google-direct");
    expect(ids).toContain("bing-direct");
    expect(ids).toContain("bing-jina");
  });

  it("uses Bing RSS so result links are directly parseable", () => {
    const bing = sourceList('site:linkedin.com/in "technical recruiter" React Bengaluru')
      .find(source => source.id === "bing-direct");
    expect(bing?.url).toContain("format=rss");
    expect(decodeURIComponent(bing?.url ?? "")).toContain('site:linkedin.com/in "technical recruiter" React Bengaluru');
  });

  it("includes public Jina search when no API key is configured", () => {
    const previous = process.env.JINA_API_KEY;
    delete process.env.JINA_API_KEY;
    try {
      expect(sourceList("frontend recruiter").find(source => source.id === "jina-search")?.url).toContain("https://s.jina.ai/");
    } finally {
      if (previous === undefined) delete process.env.JINA_API_KEY;
      else process.env.JINA_API_KEY = previous;
    }
  });

  it("preserves the explicit LinkedIn profile site operator", () => {
    const query = 'site:linkedin.com/in "technical recruiter" "Frontend Engineer" "Bengaluru"';
    const sources = sourceList(query);
    const google = sources.find(source => source.id === "google-direct");
    expect(google?.url).toContain(encodeURIComponent(query));
    expect(decodeURIComponent(google?.url ?? "")).toContain(query);
  });

  it("preserves LinkedIn hiring-post constraints", () => {
    const query = 'site:linkedin.com/posts "we are hiring" "Frontend Engineer" "Bengaluru"';
    const google = sourceList(query).find(source => source.id === "google-direct");
    expect(decodeURIComponent(google?.url ?? "")).toContain(query);
  });

  it("does not rewrite unrelated public-search queries", () => {
    const query = 'site:example.com "Frontend Engineer" Bengaluru';
    expect(sourceList(query).find(source => source.id === "google-direct")?.url).toContain(encodeURIComponent(query));
  });
});
