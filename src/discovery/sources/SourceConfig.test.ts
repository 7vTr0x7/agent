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

  it("rejects malformed configuration", () => {
    expect(() => parseSourceConfigs("not-json")).toThrow("valid JSON");
    expect(() => parseSourceConfigs(JSON.stringify({ id: "x" }))).toThrow("JSON array");
  });

  it("rejects unsupported source types", () => {
    expect(() => parseSourceConfigs(JSON.stringify([{ id: "x", type: "scrape", name: "x" }]))).toThrow("type is invalid");
  });
});
