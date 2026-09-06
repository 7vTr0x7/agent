import { HunterRecruiterDiscoveryProvider } from "./HunterRecruiterDiscoveryProvider";

function response(status: number, payload: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

describe("HunterRecruiterDiscoveryProvider transient retries", () => {
  it("does not retry client/auth errors", async () => {
    const fetchImpl: typeof fetch = jest.fn().mockResolvedValue(response(401, { errors: [] }));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const provider = new HunterRecruiterDiscoveryProvider({
      apiKey: "secret",
      fetchImpl,
      maxRetries: 2,
      sleepImpl
    });

    await expect(provider.verify("recruiter@example.com")).rejects.toThrow("HTTP 401");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("retries 429/5xx responses and honors Retry-After", async () => {
    const fetchImpl: typeof fetch = jest.fn()
      .mockResolvedValueOnce(response(429, { errors: [] }, { "retry-after": "1" }))
      .mockResolvedValueOnce(response(503, { errors: [] }))
      .mockResolvedValueOnce(response(200, { data: { status: "valid", score: 100 } }));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const provider = new HunterRecruiterDiscoveryProvider({
      apiKey: "secret",
      fetchImpl,
      maxRetries: 2,
      retryDelayMs: 250,
      sleepImpl
    });

    await expect(provider.verify("recruiter@example.com")).resolves.toEqual({
      email: "recruiter@example.com",
      verified: true,
      status: "valid",
      confidence: 100
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepImpl).toHaveBeenNthCalledWith(2, 250);
  });

  it("stops after the configured retry budget", async () => {
    const fetchImpl: typeof fetch = jest.fn().mockResolvedValue(response(503, { errors: [] }));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const provider = new HunterRecruiterDiscoveryProvider({
      apiKey: "secret",
      fetchImpl,
      maxRetries: 1,
      sleepImpl
    });

    await expect(provider.discover({
      companyName: "Example",
      companyDomain: "example.com",
      jobTitle: "Frontend Engineer",
      jobDescription: "React",
      candidateProfileId: "profile-1"
    })).rejects.toThrow("HTTP 503");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });
});
