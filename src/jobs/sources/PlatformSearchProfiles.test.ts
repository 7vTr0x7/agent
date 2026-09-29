import { getPlatformSearchUrls } from "./PlatformSearchProfiles";

describe("PlatformSearchProfiles", () => {
  it.each([
    ["Cutshort", "https://cutshort.io/jobs/reactjs-jobs-in-bangalore-bengaluru"],
    ["Hirist", "https://www.hirist.tech/k/reactjs-jobs?pref=rl"],
    ["Foundit", "https://www.foundit.in/search/reactjs-jobs-in-bengaluru-bangalore"]
  ])("preserves verified first-party search pages for %s while adding public-provider fan-out", (platform, expected) => {
    const urls = getPlatformSearchUrls(platform);
    expect(urls).toContain(expected);
    expect(urls.length).toBeGreaterThan(4);
    expect(urls.some((url) => url.includes("google.com/search"))).toBe(true);
    expect(urls.some((url) => url.includes("bing.com/search"))).toBe(true);
    expect(urls.some((url) => url.includes("duckduckgo.com/html"))).toBe(true);
  });

  it("provides the complete public-search provider fan-out for platforms without a first-party profile", () => {
    const urls = getPlatformSearchUrls("Naukri");
    expect(urls.length).toBeGreaterThan(8);
    expect(urls.some((url) => url.includes("google.com/search"))).toBe(true);
    expect(urls.some((url) => url.includes("bing.com/search"))).toBe(true);
    expect(urls.some((url) => url.includes("duckduckgo.com/html"))).toBe(true);
  });
});
