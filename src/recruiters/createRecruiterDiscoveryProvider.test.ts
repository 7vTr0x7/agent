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
});
