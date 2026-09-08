import { parseSourceConfigs } from "./SourceConfig";

describe("parseSourceConfigs", () => {
  it("parses multiple source types without hard-coded companies", () => {
    const result = parseSourceConfigs(JSON.stringify([
      { id: "gh-acme", type: "ats", name: "greenhouse", boardToken: "acme", companyDomain: "acme.com" },
      { id: "ashby-startup", type: "ats", name: "ashby", boardName: "startup" }
    ]));
    expect(result).toHaveLength(2);
    expect(result[0]?.boardToken).toBe("acme");
    expect(result[0]?.companyDomain).toBe("acme.com");
    expect(result[1]?.boardName).toBe("startup");
  });

  it("parses URL-backed web and structured-data sources", () => {
    const result = parseSourceConfigs(JSON.stringify([
      { id: "board:web", type: "web", name: "board", url: "https://example.com/jobs" },
      { id: "job:jsonld", type: "structured-data", name: "job", url: "https://example.com/job/1" }
    ]));
    expect(result.map((source) => source.url)).toEqual([
      "https://example.com/jobs",
      "https://example.com/job/1"
    ]);
  });

  it("rejects malformed configuration", () => {
    expect(() => parseSourceConfigs("not-json")).toThrow("valid JSON");
    expect(() => parseSourceConfigs(JSON.stringify({ id: "x" }))).toThrow("JSON array");
  });

  it("rejects unsupported source types", () => {
    expect(() => parseSourceConfigs(JSON.stringify([{ id: "x", type: "scrape", name: "x" }]))).toThrow("type is invalid");
  });

  it("rejects web sources without a URL", () => {
    expect(() => parseSourceConfigs(JSON.stringify([{ id: "x", type: "web", name: "x" }]))).toThrow("url is required");
  });

  it("rejects duplicate source identifiers", () => {
    expect(() => parseSourceConfigs(JSON.stringify([
      { id: "duplicate", type: "rss", name: "one", feedUrl: "https://example.com/one.xml" },
      { id: "duplicate", type: "rss", name: "two", feedUrl: "https://example.com/two.xml" }
    ]))).toThrow("duplicate id: duplicate");
  });
});
