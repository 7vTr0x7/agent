# Phase 10 Operations

Phase 10 adds controlled production activation without changing the Phase 1–9 architecture.

## Recruiter-first without a job

`PROACTIVE_RECRUITER` is a first-class campaign type. A proactive sequence has `job_opportunity_id = NULL`; it never creates a placeholder job, application URL, match, or requisition merely to satisfy relational structure.

The path is profile/target-role driven:

`candidate profile -> target roles -> public company/recruiter evidence -> recruiter identity -> relevance -> mailbox verification -> suppression -> durable campaign dedup -> personalized outreach -> Gmail final gate`.

Recruiter relevance is persisted separately from hiring evidence. `CURRENT` and `RECENT` require explicit hiring/recruiting evidence; a recruiter identity or company careers page alone does not prove a current opening. `HISTORICAL` and `UNKNOWN` remain honest alternatives.

## Two acquisition paths

Job-specific recruiter outreach and proactive recruiter-first outreach use the same recruiter contact, mailbox verification, suppression, campaign, message, Gmail, follow-up, inbound, lease, and observability infrastructure. Job discovery is not a prerequisite for proactive campaigns.

## Mailbox verification

Live recruiter sending requires explicit mailbox-level verification evidence. MX-only, public-web-only, syntactically valid, guessed, or legacy verification states are not sufficient. The recipient domain must match the documented employer domain and the recruiter must remain `CURRENT` or `RECENT` and unsuppressed at the final gate.

## Gmail activation

Gmail is independently controlled from discovery and application automation. Safe defaults are:

- `GMAIL_ENABLED=false`
- `OUTBOUND_ENABLED=false`
- `PROACTIVE_RECRUITER_ENABLED=false`
- `PROACTIVE_RECRUITER_SEND_ENABLED=false`
- `RECRUITER_OUTREACH_DRY_RUN=true`
- `RECRUITER_OUTREACH_ACTIVATION=disabled`
- `APPLICATION_DRY_RUN=true`
- `APPLICATION_LIVE_ENABLED=false`

Run `npm run gmail:verify` to validate OAuth/account identity without sending mail.

Real recruiter delivery requires the canonical send gate. A canary additionally requires `RECRUITER_CONTROLLED_SEND_CONFIRM=SEND_ONE_REAL_EMAIL`, an explicit `RECRUITER_CONTROLLED_MESSAGE_ID`, an explicit `RECRUITER_CONTROLLED_RECIPIENT`, and one-message-per-hour/day limits. Broad live delivery additionally requires `RECRUITER_LIVE_ACTIVATION_CONFIRMED=true`.

The database-backed global emergency stop defaults to active after migration 038. It is checked before send claiming and immediately before the Gmail provider call. Clearing it is an explicit operator action and must be auditable.

## Send identity and ambiguity

Recruiter messages use deterministic client Message-IDs. Database claiming is atomic and rate limits are database-backed. A provider timeout, connection reset, crash after transmission, or missing response is treated as ambiguous and is not blindly retried. Reconciliation must establish the external outcome first.

## Follow-ups and inbound

Existing Day 4/10/18 follow-ups remain canonical. Every follow-up is rechecked for reply, suppression, campaign status, verification, rate limits, lease, Gmail availability, and the global emergency stop. Gmail thread/message headers are used for inbound campaign association. A genuine recruiter reply stops automated follow-up and moves the campaign into the existing reply/interview/rejection state model.

## Resume attachments

Initial recruiter messages may attach only the configured candidate resume. The file must exist, be a regular file, be non-empty, and stay within the configured attachment limit. No arbitrary directory file is selected when an explicit path is configured.

## Applications

Phase 9 application adapters and browser safety remain unchanged in principle. Live application submission now has the additional `APPLICATION_LIVE_ENABLED` gate, while `APPLICATION_DRY_RUN=true` remains the default. CAPTCHA, MFA, authentication walls, Cloudflare/bot challenges, prompt injection, unsafe redirects/hosts, unsupported adapters, ambiguous outcomes, missing data, and excluded employers remain blocked/manual-review paths.

The application engine continues to use permanent application deduplication and evidence-backed submission state. A blocked application can still use the canonical recruiter fallback where policy permits; proactive recruiter campaigns never manufacture a job.

## Readiness and operations

Run:

`npm run phase10:readiness`

The command reports database, profile, resume, Gmail, recruiter verification, suppression, outbound, recruiter-first, rate limiting, deduplication, follow-up, inbound, application, browser, worker, scheduler, kill switch, security, database identity, and activation state. It never sends email or submits an application.

Use the existing worker/scheduler infrastructure. Proactive recruiter discovery is scheduled independently of application automation and can run when job discovery has zero relevant jobs.

## Emergency stop

The global emergency stop must remain active during hardening. When active, recruiter email and application submission are blocked while safe discovery/analysis may continue. The stop is checked at the irreversible side-effect boundaries, not only at startup.

## Controlled live testing

Hardening never sends to arbitrary recruiters. A live test must be explicitly configured and bounded to an approved target. The test must record the selected campaign/message, recipient, provider identifiers, timestamps, and outcome. No live test is run automatically by CI. The absence of credentials is a configuration limitation, not a code failure.

## Discovery federation

Phase 10 does not reduce the existing broad platform federation. Concurrency limits bound simultaneous work; they do not cap the number of platforms searched.

## Security

External job, recruiter, email, and application content is untrusted data. It cannot select tools, execute shell commands, change environment variables, reveal credentials, disable safety gates, or authorize external actions. CAPTCHA, MFA, bot protections, and provider rate limits are respected rather than bypassed.
