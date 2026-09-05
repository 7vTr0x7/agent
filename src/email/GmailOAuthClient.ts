interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface GmailOAuthClientOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}

export class GmailOAuthClient {
  private readonly fetchImpl: typeof fetch;
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(private readonly options: GmailOAuthClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) {
      return this.accessToken;
    }

    const response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        refresh_token: this.options.refreshToken,
        grant_type: "refresh_token"
      })
    });

    if (!response.ok) {
      throw new Error(`Gmail OAuth token refresh failed (${response.status}).`);
    }

    const token = (await response.json()) as TokenResponse;
    if (!token.access_token) {
      throw new Error("Gmail OAuth token refresh returned no access token.");
    }

    this.accessToken = token.access_token;
    this.expiresAt = Date.now() + token.expires_in * 1000;
    return token.access_token;
  }
}
