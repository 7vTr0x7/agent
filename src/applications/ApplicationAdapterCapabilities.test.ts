import { effectiveApplicationCapabilities } from "./ApplicationAdapterCapabilities";

describe("application adapter capabilities", () => {
  it("keeps discovery-only platforms catalog-only", () => {
    const capabilities = effectiveApplicationCapabilities({
      name: "naukri",
      canHandle: () => true,
      submit: async () => ({ submitted: true, externalApplicationId: null, confirmationUrl: null, reason: "test" })
    });
    expect(capabilities?.application).toBe("CATALOG_ONLY");
  });

  it("permits only the explicitly active ATS set", () => {
    expect(effectiveApplicationCapabilities({ name: "greenhouse", canHandle: () => true, submit: async () => ({ submitted: false, externalApplicationId: null, confirmationUrl: null, reason: "test" }) })?.application).toBe("ACTIVE");
    expect(effectiveApplicationCapabilities({ name: "generic-form", canHandle: () => true, submit: async () => ({ submitted: false, externalApplicationId: null, confirmationUrl: null, reason: "test" }) })?.application).toBe("UNSUPPORTED");
  });
});
