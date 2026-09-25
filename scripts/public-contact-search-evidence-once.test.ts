import { searchSources } from "./public-contact-search-evidence-once";

describe("public contact search evidence boundary", () => {
  it("uses real search providers without treating search infrastructure as a contact resource", () => {
    const sources = searchSources('"React developer" Bengaluru hiring email');
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((source) => source.id)).toEqual(expect.arrayContaining([
      "google-direct",
      "bing-direct"
    ]));
    expect(sources.every((source) => source.url.startsWith("https://"))).toBe(true);
    expect(sources.some((source) => source.url.includes("r.jina.ai/https://"))).toBe(false);
  });
});
