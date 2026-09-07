# Recruiter Outreach Activation Procedure

Recruiter outreach is disabled by default. This document defines the only supported progression from dry-run to a controlled real-send canary and then to live operation.

## 1. Validate the repository

Run the project's standard validation from the repository root:

```bash
cd ~/projects/job-agent
git pull
npm run typecheck && npm run build && npm test -- --runInBand
```

Do not enable real sending if any command fails.

## 2. Dry-run checkpoint

Keep the default recruiter activation disabled and dry-run enabled. Execute the recruiter dry-run script and inspect the generated discovery/preparation results.

```bash
npm run dry-run:recruiter-outreach
```

The dry-run must not call Gmail `sendMessage`.

## 3. Canary checkpoint

A canary is exactly one recruiter message per day and one per hour. The canary requires:

- `RECRUITER_OUTREACH_ACTIVATION=canary`
- `RECRUITER_DRY_RUN=false`
- `RECRUITER_OUTBOUND_ENABLED=true`
- `RECRUITER_MAX_MESSAGES_PER_DAY=1`
- `RECRUITER_MAX_MESSAGES_PER_HOUR=1`
- all existing recruiter safety gates to pass, including verified-email and confidence requirements

Do not use the canary mode with wider limits. The runtime activation gate rejects it.

After the one-message canary is sent, reconcile Gmail before any further activation:

```bash
npm run reconcile:recruiter-outreach
```

Confirm the message has a Gmail provider message ID/thread ID and that the database state is `SENT`.

## 4. Live activation

Live mode requires explicit confirmation in addition to the global outbound switch:

- `RECRUITER_OUTREACH_ACTIVATION=live`
- `RECRUITER_DRY_RUN=false`
- `RECRUITER_OUTBOUND_ENABLED=true`
- `RECRUITER_LIVE_ACTIVATION_CONFIRMED=true`

The configured daily/hourly limits must also pass the recruiter preflight and Gmail-tier ceiling checks. Do not copy a consumer Gmail limit to a Workspace account or vice versa without verifying the actual account tier.

## 5. Stop conditions

Immediately keep or return activation to `disabled` if any of these occur:

- unexpected recipient or domain
- unverified recruiter email
- low confidence contact
- duplicate application/contact sequence
- suppression match
- Gmail authentication/send error
- unexplained stale `SENDING` messages
- bounce or opt-out signal
- reconciliation cannot determine whether a message was delivered

Never resolve an ambiguous stale `SENDING` record by blindly retrying it. Reconciliation must first determine whether the deterministic RFC `Message-ID` exists in Gmail Sent mail.

## 6. Throughput policy

The live target is the configured Gmail account ceiling, not an arbitrary 100-message ceiling. Sending must remain paced and governed by the atomic database rate limiter. Published Gmail limits are ceilings, not a promise of uninterrupted delivery.

The application must never automatically switch from dry-run or canary to live mode.
