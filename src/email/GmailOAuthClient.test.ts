import { GmailOAuthClient } from "./GmailOAuthClient";

describe("GmailOAuthClient", () => {
  const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });

  it("shares one refresh request across concurrent callers", async () => {
    let resolveRequest!: (value: Response) => void;
    const request = new Promise<Response>((resolve) => { resolveRequest = resolve; });
    const fetchImpl = jest.fn().mockReturnValue(request);
    const client = new GmailOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      fetchImpl
    });

    const first = client.getAccessToken();
    const second = client.getAccessToken();
    resolveRequest(response(200, { access_token: "token", expires_in: 3600, token_type: "Bearer" }));

    await expect(Promise.all([first, second])).resolves.toEqual(["token", "token"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries transient refresh failures", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(response(200, { access_token: "token", expires_in: 3600, token_type: "Bearer" }));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const client = new GmailOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      fetchImpl,
      retryDelayMs: 10,
      sleepImpl
    });

    await expect(client.getAccessToken()).resolves.toBe("token");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(10);
  });

  it("honors Retry-After for rate-limited refreshes", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(429, {}, { "Retry-After": "2" }))
      .mockResolvedValueOnce(response(200, { access_token: "token", expires_in: 3600, token_type: "Bearer" }));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const client = new GmailOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      fetchImpl,
      retryDelayMs: 10,
      sleepImpl
    });

    await expect(client.getAccessToken()).resolves.toBe("token");
    expect(sleepImpl).toHaveBeenCalledWith(2000);
  });

  it("does not retry permanent authorization failures", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(400, {}));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const client = new GmailOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      fetchImpl,
      sleepImpl
    });

    await expect(client.getAccessToken()).rejects.toThrow("Gmail OAuth token refresh failed (400)");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("rejects successful refresh responses with invalid expiry", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, { access_token: "token", expires_in: 0, token_type: "Bearer" }));
    const client = new GmailOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      fetchImpl
    });

    await expect(client.getAccessToken()).rejects.toThrow("invalid expiry");
  });
});
