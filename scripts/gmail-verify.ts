import "dotenv/config";

import { GmailOAuthClient } from "../src/email/GmailOAuthClient";

const clientId = process.env.GMAIL_CLIENT_ID?.trim();
const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
const expectedEmail = process.env.GMAIL_USER_EMAIL?.trim().toLowerCase();

if (!clientId || !clientSecret || !refreshToken || !expectedEmail) {
  throw new Error("GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and GMAIL_USER_EMAIL are required.");
}

const oauth = new GmailOAuthClient({ clientId, clientSecret, refreshToken });
const accessToken = await oauth.getAccessToken();

const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
  headers: { authorization: `Bearer ${accessToken}` }
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`Gmail profile verification failed (${response.status}): ${body.slice(0, 300)}`);
}

const profile = (await response.json()) as { emailAddress?: string; messagesTotal?: number; threadsTotal?: number };
const actualEmail = profile.emailAddress?.trim().toLowerCase();

if (!actualEmail) {
  throw new Error("Gmail profile verification returned no email address.");
}

if (actualEmail !== expectedEmail) {
  throw new Error(`Gmail account mismatch: configured ${expectedEmail}, authorized ${actualEmail}.`);
}

console.log("Gmail connection verified successfully.");
console.log(`Authorized account: ${actualEmail}`);
console.log(`Mailbox messages: ${profile.messagesTotal ?? "unknown"}`);
console.log(`Mailbox threads: ${profile.threadsTotal ?? "unknown"}`);
console.log("OAuth refresh-token flow is working and the configured Gmail account matches.");
console.log("No email was sent by this verification command.");
