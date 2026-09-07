import "dotenv/config";
import { createServer } from "node:http";
import { URL } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const clientId = process.env.GMAIL_CLIENT_ID?.trim();
const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
const port = Number(process.env.GMAIL_OAUTH_PORT ?? "42813");
const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
const scopes = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly"
];

if (!clientId || !clientSecret) {
  throw new Error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET before running npm run gmail:authorize.");
}
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("GMAIL_OAUTH_PORT must be a valid TCP port.");
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", scopes.join(" "));
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("\nOpen this URL in your browser and authorize the Gmail account you want the agent to use:\n");
console.log(authUrl.toString());
console.log(`\nWaiting for Google callback on ${redirectUri} ...`);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", redirectUri);
    if (requestUrl.pathname !== "/oauth2callback") {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }

    const error = requestUrl.searchParams.get("error");
    if (error) throw new Error(`Google OAuth authorization failed: ${error}`);

    const code = requestUrl.searchParams.get("code");
    if (!code) throw new Error("Google OAuth callback did not contain an authorization code.");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      throw new Error(`Google token exchange failed (${tokenResponse.status}): ${body.slice(0, 300)}`);
    }

    const token = (await tokenResponse.json()) as { refresh_token?: string };
    if (!token.refresh_token) {
      throw new Error("Google did not return a refresh token. Re-run with prompt=consent or revoke the existing grant and authorize again.");
    }

    const envPath = ".env";
    const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    const next = setEnv(existing, "GMAIL_REFRESH_TOKEN", token.refresh_token);
    const gmailEnabled = setEnv(next, "GMAIL_ENABLED", "true");
    writeFileSync(envPath, gmailEnabled, { mode: 0o600 });

    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end("<h2>Gmail authorization successful.</h2><p>You can close this window and return to the terminal.</p>");
    console.log("\nGmail authorization successful. Refresh token saved to local .env with mode 0600.");
    console.log("Real recruiter sending remains disabled until the explicit activation gates are satisfied.\n");
  } catch (error) {
    response.statusCode = 400;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end(error instanceof Error ? error.message : String(error));
    console.error("\nGmail authorization failed:", error);
  } finally {
    setTimeout(() => server.close(), 100);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local OAuth callback server listening on ${redirectUri}`);
});

function setEnv(content: string, key: string, value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
  const line = `${key}=${escaped}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
}
