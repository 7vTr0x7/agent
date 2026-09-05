# Gmail recruiter-response monitoring

The job agent uses Gmail only for recruiter/application-response intelligence and future same-thread follow-ups. Resend remains the separate channel for system notifications.

## Google Cloud setup

1. Create or select a Google Cloud project.
2. Enable the Gmail API.
3. Configure the OAuth consent screen for the account that will authorize the job agent.
4. Create an OAuth 2.0 client suitable for a local/web-server application.
5. Authorize the account with offline access and the minimum Gmail scope needed by the feature set. The current implementation is designed around `https://www.googleapis.com/auth/gmail.modify` because it supports reading, labeling, and sending mail from the same account.
6. Store the resulting refresh token only in `.env`; never commit it.

## Environment

```env
GMAIL_ENABLED=true
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_USER_EMAIL=your-address@gmail.com
GMAIL_SYNC_QUERY=newer_than:14d -from:me
GMAIL_SYNC_INTERVAL_MS=120000
```

The worker refreshes the short-lived access token automatically from the refresh token. No access token is stored in the repository.

## What the sync does

- Lists recent mailbox messages using the configured Gmail search query.
- Fetches full message data only for the returned IDs.
- Extracts sender, thread ID, RFC message ID, subject, body text, and received time.
- Persists messages idempotently by Gmail message ID.
- Classifies messages as application confirmation, interview, positive/shortlist, rejection, or other.
- Associates a message with an active application only when a strong thread/company/title signal exists.
- Updates the application to `RESPONDED` or `REJECTED` when appropriate.
- Preserves the Gmail thread ID for the later same-thread follow-up engine.

## Safety

The system does not automatically reply to recruiter mail in this phase. Sending replies is a separate workflow that will require its own policy gate, duplicate prevention, thread validation, and explicit automation settings.
