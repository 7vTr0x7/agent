import { sourceList } from "./PublicSearchProviderRegistry";

describe("PublicSearchProviderRegistry", () => {
  it("includes direct public Google and Bing sources alongside existing providers", () => {
    const ids = sourceList('"Frontend Developer" hiring React').map(source => source.id);
    expect(ids).toContain("google-direct");
    expect(ids).toContain("bing-direct");
    expect(ids).toContain("bing-jina");
  });
});

  it("includes public Jina search when no API key is configured", () => { const previous = process.env.JINA_API_KEY; delete process.env.JINA_API_KEY; try { expect(sourceList("frontend recruiter").find(source => source.id === "jina-search")?.url).toContain("https://s.jina.ai/"); } finally { if (previous === undefined) delete process.env.JINA_API_KEY; else process.env.JINA_API_KEY = previous; } });
