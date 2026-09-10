import { getPlatformSearchUrls } from "./PlatformSearchProfiles";

describe("PlatformSearchProfiles", () => {
  it.each([
    ["Cutshort", "https://cutshort.io/jobs/reactjs-jobs-in-bangalore-bengaluru"],
    ["Hirist", "https://www.hirist.tech/k/reactjs-jobs?pref=rl"],
    ["Foundit", "https://www.foundit.in/search/reactjs-jobs-in-bengaluru-bangalore"]
  ])("provides a verified first-party search page for %s", (platform, expected) => {
    const urls = getPlatformSearchUrls(platform);
    expect(urls).toContain(expected);
    expect(urls.length).toBe(4);
  });

  it("does not add platform-specific search URLs for unrelated platforms", () => {
    expect(getPlatformSearchUrls("Naukri")).toEqual([]);
    expect(getPlatformSearchUrls("LinkedIn Jobs")).toEqual([]);
  });
});
