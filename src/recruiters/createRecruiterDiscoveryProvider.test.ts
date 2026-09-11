import { createRecruiterDiscoveryProvider } from "./createRecruiterDiscoveryProvider";

describe("createRecruiterDiscoveryProvider", () => {
  it("uses the public-web provider without external credentials", () => {
    const provider = createRecruiterDiscoveryProvider({ provider: "public-web" });
    expect(provider.name).toBe("public-web");
  });

  it("ignores legacy external-provider credentials for the public-web provider", () => {
    const provider = createRecruiterDiscoveryProvider({
      provider: "public-web",
      hunterApiKey: "legacy-hunter-key",
      snovClientId: "legacy-client-id",
      snovClientSecret: "legacy-client-secret"
    });
    expect(provider.name).toBe("public-web");
  });

  it("selects Snov only when explicitly configured and credentials are present", () => {
    const provider = createRecruiterDiscoveryProvider({
      provider: "snov",
      snovClientId: "id",
      snovClientSecret: "value"
    });
    expect(provider.name).toBe("snov");
  });

  it("rejects Snov configuration without both credentials", () => {
    expect(() => createRecruiterDiscoveryProvider({ provider: "snov", snovClientId: "id" })).toThrow("SNOV_CLIENT_ID and SNOV_CLIENT_SECRET");
    expect(() => createRecruiterDiscoveryProvider({ provider: "snov", snovClientSecret: "value" })).toThrow("SNOV_CLIENT_ID and SNOV_CLIENT_SECRET");
  });
});
