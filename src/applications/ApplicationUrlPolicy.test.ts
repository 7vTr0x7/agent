import { validateApplicationNavigationUrl } from "./ApplicationUrlPolicy";

describe("application URL safety policy", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = originalEnv; });

  it("requires HTTPS outside isolated localhost tests", () => {
    process.env.NODE_ENV = "production";
    expect(validateApplicationNavigationUrl("http://example.com/apply").allowed).toBe(false);
    expect(validateApplicationNavigationUrl("https://example.com/apply").allowed).toBe(true);
  });

  it("allows loopback only in tests and blocks host substitution", () => {
    process.env.NODE_ENV = "test";
    expect(validateApplicationNavigationUrl("http://127.0.0.1:3000/apply").allowed).toBe(true);
    expect(validateApplicationNavigationUrl("https://evil.example/apply", "jobs.example.com").allowed).toBe(false);
  });

  it("rejects embedded credentials", () => {
    process.env.NODE_ENV = "production";
    const result = validateApplicationNavigationUrl("https://user:password@example.com/apply");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/embedded credentials/i);
  });
});
