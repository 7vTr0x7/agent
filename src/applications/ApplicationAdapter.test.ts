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
  it("resolves the first adapter that can handle a URL", () => {
    const first = adapter("greenhouse", ["greenhouse.io"]);
    const second = adapter("lever", ["lever.co"]);
    const registry = new ApplicationAdapterRegistry([first, second]);

    expect(registry.resolve("https://jobs.greenhouse.io/acme")?.name).toBe("greenhouse");
    expect(registry.resolve("https://jobs.lever.co/acme")?.name).toBe("lever");
  });

  it("returns null when no adapter supports the URL", () => {
    const registry = new ApplicationAdapterRegistry([
      adapter("greenhouse", ["greenhouse.io"])
    ]);

    expect(registry.resolve("https://example.com/jobs/1")).toBeNull();
  });
});
