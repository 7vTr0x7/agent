import { JOB_PLATFORM_COUNT, JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";

describe("JobPlatformRegistry", () => {
  it("contains the full federation catalog without accidental truncation", () => {
    expect(JOB_PLATFORM_COUNT).toBeGreaterThanOrEqual(200);
    expect(JOB_PLATFORM_REGISTRY).toHaveLength(JOB_PLATFORM_COUNT);
  });

  it("assigns unique identifiers and honest capability classifications", () => {
    const ids = JOB_PLATFORM_REGISTRY.map((platform) => platform.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const platform of JOB_PLATFORM_REGISTRY) {
      expect(["active-adapter", "configurable-adapter", "catalog-only"]).toContain(platform.capability);
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
});
