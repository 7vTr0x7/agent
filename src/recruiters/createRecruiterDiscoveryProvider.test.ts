import { createRecruiterDiscoveryProvider } from "./createRecruiterDiscoveryProvider";

describe("createRecruiterDiscoveryProvider", () => {
  it("uses the public job-posting provider without external credentials", () => {
    const provider = createRecruiterDiscoveryProvider({ provider: "job-posting" });
    expect(provider.name).toBe("job-posting");
  });

  it("requires Snov credentials when Snov is selected", () => {
    expect(() => createRecruiterDiscoveryProvider({ provider: "snov" })).toThrow(
      "Snov recruiter discovery requires SNOV_CLIENT_ID and SNOV_CLIENT_SECRET"
    );
  });

  it("requires Hunter credentials when Hunter is selected", () => {
    expect(() => createRecruiterDiscoveryProvider({ provider: "hunter" })).toThrow(
      "Hunter recruiter discovery requires HUNTER_API_KEY"
    );
  });

  it("creates the configured external provider with public-job fallback", () => {
    const snov = createRecruiterDiscoveryProvider({
      provider: "snov",
      snovClientId: "client-id",
      snovClientSecret: "client-secret"
    });
    expect(snov.name).toBe("snov->job-posting");

    const hunter = createRecruiterDiscoveryProvider({
      provider: "hunter",
      hunterApiKey: "api-key"
    });
    expect(hunter.name).toBe("hunter->job-posting");
  });
});
