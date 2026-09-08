interface TokenResponse {
  access_token: string;
  expires_in?: number;
  token_type: string;
}

export interface GmailOAuthClientOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryDelayMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

function retryAfterMs(response: Response, fallbackMs: number): number {
  const value = response.headers.get("retry-after");
  if (!value) return fallbackMs;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.min(Math.max(0, dateMs - Date.now()), 30_000);
  return fallbackMs;
}

export class GmailOAuthClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshPromise: Promise<string> | null = null;

  constructor(private readonly options: GmailOAuthClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
    this.sleepImpl = options.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) {
      return this.accessToken;
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshAccessToken().finally(() => {
        this.refreshPromise = null;
      });
    }

    return this.refreshPromise;
  }

  invalidateAccessToken(): void {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  private async refreshAccessToken(): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: this.options.clientId,
            client_secret: this.options.clientSecret,
            refresh_token: this.options.refreshToken,
            grant_type: "refresh_token"
          })
        });
      } catch (error) {
        if (attempt >= this.maxRetries) throw error;
        await this.sleepImpl(this.retryDelayMs * 2 ** attempt);
        continue;
      }

      if (response.ok) {
        const token = (await response.json()) as Partial<TokenResponse>;
        if (!token.access_token) {
          throw new Error("Gmail OAuth token refresh returned no access token.");
        }
        const expiresIn = token.expires_in;
        if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
          throw new Error("Gmail OAuth token refresh returned an invalid expiry.");
        }
        this.accessToken = token.access_token;
        this.expiresAt = Date.now() + expiresIn * 1000;
        return token.access_token;
      }

      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt >= this.maxRetries) {
        throw new Error(`Gmail OAuth token refresh failed (${response.status}).`);
      }

      await this.sleepImpl(retryAfterMs(response, this.retryDelayMs * 2 ** attempt));
    }
  }
}
