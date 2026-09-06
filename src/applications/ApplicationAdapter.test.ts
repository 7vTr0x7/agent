import { Page } from "playwright";
import {
  ApplicationAdapterRegistry,
  ApplicationContext,
  ApplicationSubmissionResult
} from "./ApplicationAdapter";

function adapter(name: string, domains: string[]) {
  return {
    name,
    canHandle: (url: string) => domains.some((domain) => url.includes(domain)),
    submit: async (
      _page: Page,
      _context: ApplicationContext
    ): Promise<ApplicationSubmissionResult> => ({
      submitted: true,
      externalApplicationId: null,
      confirmationUrl: null,
      reason: "test"
    })
  };
}

describe("ApplicationAdapterRegistry", () => {
  it("resolves the only specialized adapter that can handle a URL", () => {
    const first = adapter("greenhouse", ["greenhouse.io"]);
    const second = adapter("lever", ["lever.co"]);
    const registry = new ApplicationAdapterRegistry([first, second]);

    expect(registry.resolve("https://jobs.greenhouse.io/acme")?.name).toBe("greenhouse");
    expect(registry.resolve("https://jobs.lever.co/acme")?.name).toBe("lever");
  });

  it("prefers a specialized adapter over the generic fallback regardless of order", () => {
    const generic = adapter("generic-form", ["https://jobs.greenhouse.io"]);
    const greenhouse = adapter("greenhouse", ["greenhouse.io"]);
    const registry = new ApplicationAdapterRegistry([generic, greenhouse]);

    expect(registry.resolve("https://jobs.greenhouse.io/acme")?.name).toBe("greenhouse");
  });

  it("fails closed when multiple specialized adapters claim the same URL", () => {
    const first = adapter("first-specialized", ["example.com"]);
    const second = adapter("second-specialized", ["example.com"]);
    const generic = adapter("generic-form", ["https://example.com"]);
    const registry = new ApplicationAdapterRegistry([generic, first, second]);

    expect(registry.resolve("https://example.com/jobs/1")).toBeNull();
  });

  it("uses the generic adapter only when no specialized adapter matches", () => {
    const generic = adapter("generic-form", ["https://example.com"]);
    const registry = new ApplicationAdapterRegistry([generic]);

    expect(registry.resolve("https://example.com/jobs/1")?.name).toBe("generic-form");
  });

  it("returns null when no adapter supports the URL", () => {
    const registry = new ApplicationAdapterRegistry([
      adapter("greenhouse", ["greenhouse.io"])
    ]);

    expect(registry.resolve("https://example.com/jobs/1")).toBeNull();
  });
});
