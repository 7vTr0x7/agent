import { SnovRecruiterDiscoveryProvider } from "./SnovRecruiterDiscoveryProvider";

function response(payload: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("SnovRecruiterDiscoveryProvider resilience", () => {
  it("retries transient 429 responses and honors Retry-After", async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fetchImpl: typeof fetch = jest.fn()
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ error: "rate limited" }, 429, { "retry-after": "2" }))
      .mockResolvedValueOnce(response({ data: { task_hash: "verify-task" } }))
      .mockResolvedValueOnce(response({ data: [{ email: "recruiter@example.com", status: "valid", score: 98 }], status: "completed" }));

    const provider = new SnovRecruiterDiscoveryProvider({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
      maxRetries: 2,
      retryDelayMs: 250,
      timeoutMs: 5000,
      sleepImpl: sleep
    });

    await expect(provider.verify("recruiter@example.com")).resolves.toMatchObject({ verified: true, confidence: 98 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("does not retry non-transient 401 responses", async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fetchImpl: typeof fetch = jest.fn()
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ error: "unauthorized" }, 401));

    const provider = new SnovRecruiterDiscoveryProvider({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
      maxRetries: 2,
      sleepImpl: sleep
    });

    await expect(provider.verify("recruiter@example.com")).rejects.toThrow("Snov request failed with HTTP 401");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
  });
});
