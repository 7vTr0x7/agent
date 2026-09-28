import { JOB_PLATFORM_COUNT, JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";

describe("JobPlatformRegistry", () => {
  it("contains exactly the 200 registered federation platforms", () => {
    expect(JOB_PLATFORM_COUNT).toBe(200);
    expect(JOB_PLATFORM_REGISTRY).toHaveLength(200);
  });

  it("assigns unique identifiers and honest acquisition classifications", () => {
    const ids = JOB_PLATFORM_REGISTRY.map((platform) => platform.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const platform of JOB_PLATFORM_REGISTRY) {
      expect(["active-adapter", "configurable-adapter", "public-web-discovery"]).toContain(platform.capability);
      expect(platform.name.trim()).not.toBe("");
      expect(platform.id.trim()).not.toBe("");
    }
  });

  it("keeps the explicitly supported first-party adapters classified as active", () => {
    for (const name of ["Remote OK", "We Work Remotely", "Himalayas", "Jobicy", "Greenhouse", "Lever", "Ashby"]) {
      const platform = JOB_PLATFORM_REGISTRY.find((entry) => entry.name === name);
      expect(platform?.capability).toBe("active-adapter");
    }
  });

  it("routes the previously catalog-only federation entries through public web discovery", () => {
    const publicWeb = JOB_PLATFORM_REGISTRY.filter((platform) => platform.capability === "public-web-discovery");
    expect(publicWeb.length).toBeGreaterThan(100);
    expect(publicWeb.some((platform) => platform.name === "Naukri")).toBe(true);
    expect(publicWeb.some((platform) => platform.name === "LinkedIn Jobs")).toBe(true);
    expect(publicWeb.some((platform) => platform.name === "Frontend Jobs")).toBe(true);
  });
});
