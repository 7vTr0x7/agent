import { sourceList } from "./PublicSearchProviderRegistry";

describe("PublicSearchProviderRegistry", () => {
  it("includes direct public Google and Bing sources alongside existing providers", () => {
    const ids = sourceList('"Frontend Developer" hiring React').map(source => source.id);
    expect(ids).toContain("google-direct");
    expect(ids).toContain("bing-direct");
    expect(ids).toContain("bing-jina");
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

  it("broadens only the quoted role token for LinkedIn recruiter/post searches", () => {
    const sources = sourceList('site:linkedin.com/in "technical recruiter" "Frontend Engineer" "Bengaluru"');
    const google = sources.find(source => source.id === "google-direct");
    expect(google?.url).toContain(encodeURIComponent('site:linkedin.com/in "technical recruiter" React "Bengaluru"'));
    expect(google?.url).not.toContain(encodeURIComponent('"Frontend Engineer"'));
  });

  it("does not rewrite unrelated public-search queries", () => {
    const sources = sourceList('site:example.com "Frontend Engineer" Bengaluru');
    expect(sources.find(source => source.id === "google-direct")?.url).toContain(encodeURIComponent('site:example.com "Frontend Engineer" Bengaluru'));
  });
});
