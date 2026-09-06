# Recruiter Outreach Architecture

## Purpose

Recruiter outreach is a first-class objective of the job agent, not a notification side effect. For every eligible job application attempt, the system should independently attempt to discover relevant professional recruiter/talent contacts and, when a safe contact is available, send a personalized application-introduction email regardless of whether the website application succeeds or fails.

The outreach pipeline must remain independent from the ATS submission result while sharing the same job, company, candidate, exclusion, deduplication, and audit context.

## Core invariant

```text
Eligible job
  -> application attempt
       -> SUCCESS / BLOCKED / FAILED
  -> recruiter discovery (independent branch)
       -> ranked professional contacts
  -> outreach safety gate
       -> email send
       -> follow-up sequence
       -> reply / bounce / opt-out detection
```

A failed ATS application must not prevent recruiter outreach. A successful ATS application must not suppress recruiter outreach. A permanent company exclusion, invalid job/candidate state, explicit recruiter suppression, or outreach safety failure must prevent sending.

## Why this architecture

The existing application system already has durable task queues, application deduplication, application attempt recording, Gmail synchronization, follow-up scheduling, and email abstractions. Recruiter outreach should extend those boundaries rather than introduce a second workflow engine.

The current application handler records the application outcome and then sends candidate-facing application notifications. Recruiter outreach should be added as a separate durable task after the application outcome is known, rather than coupling recruiter discovery to browser automation.

## Components

### 1. Recruiter Discovery Service

Responsibilities:

- Resolve the employer's canonical website/domain from the job/company metadata.
- Query configured contact-discovery providers.
- Prefer professional company-domain contacts.
- Capture source URLs, provider confidence, title, department, seniority, and discovery timestamp.
- Normalize and deduplicate contacts.
- Never synthesize an email address merely from a guessed company pattern.

Initial provider strategy:

1. Hunter Domain Search / Email Finder as the first provider adapter.
2. Provider interface allows additional vendors later without changing application logic.
3. Public company website/contact pages can be a secondary source.
4. Search-engine or social-network discovery must remain an explicit provider with its own terms/rate limits; do not build brittle platform scraping into the core.

### 2. Recruiter Ranking Service

Rank contacts using deterministic signals before any AI enrichment:

- recruiter/talent-acquisition title match
- technical recruiter / engineering recruiter match
- talent partner / talent acquisition partner match
- hiring manager relevance to the job family
- company-domain match
- India/Bengaluru relevance when available
- source confidence
- email verification status
- recency of source
- generic-vs-personal address

Example role priority:

```text
Technical Recruiter
Engineering Recruiter
Talent Acquisition Partner
Technical Talent Partner
Recruiter
Talent Acquisition
Hiring Manager
HR
Generic careers/recruiting inbox
```

Personal professional contacts should normally rank above generic inboxes. Generic addresses remain useful as a fallback but should not be treated as named recruiters.

### 3. Outreach Policy / Safety Gate

The outreach gate runs independently from the ATS safety gate.

Hard blocks:

- permanent excluded company
- candidate has no configured outbound email identity
- recruiter contact is not a valid professional contact
- email is disposable/webmail when policy requires company mail
- verification status is invalid
- contact is globally suppressed
- contact/company is already in an active outreach sequence
- daily/hourly recruiter outreach limit exceeded
- provider confidence below configured threshold
- provider/source data is stale beyond configured policy
- outreach dry-run mode enabled

The gate should return a structured reason rather than silently skipping a contact.

### 4. Outreach Composer

Generate a short, personalized job-specific email from deterministic structured context first. AI may improve wording, but it must not invent recruiter facts, company facts, job details, achievements, or contact relationships.

The message should contain:

- truthful candidate introduction
- exact job title
- company name
- relevant stack/experience selected from the candidate profile
- application status: submitted, blocked, or failed
- job/application URL when appropriate
- concise request for consideration or routing
- professional signature

The composer should produce both plain text and HTML variants and retain the exact rendered body used for auditability.

### 5. Email Sender

Use a provider abstraction:

```text
RecruiterEmailSender
  -> GmailApiRecruiterSender (primary)
  -> ResendRecruiterSender (optional future provider)
```

Gmail API is the preferred first implementation because the existing project already has Gmail OAuth/mailbox infrastructure and Gmail can send messages and maintain normal mailbox/thread semantics.

The sender must return provider message ID, thread ID when available, sent timestamp, and accepted recipient.

### 6. Follow-up Scheduler

Each recruiter contact receives a durable sequence, not a timer hidden in process memory.

Default sequence should be conservative and configurable, for example:

```text
Day 0  initial outreach
Day 4  first follow-up
Day 10 second follow-up
Day 18 final follow-up
```

The scheduler must cancel remaining steps when:

- recruiter replies
- candidate marks contact as not interested
- contact opts out
- email bounces permanently
- job closes/withdrawn state is known
- candidate is hired/placed
- company is added to exclusion list

Do not continue follow-ups merely because a browser application failed.

### 7. Reply / Bounce / Opt-out Processor

The existing Gmail synchronization pipeline should become the inbound event source.

Inbound processing should classify:

- positive recruiter response
- neutral/needs-information response
- rejection
- automated acknowledgement
- bounce
- unsubscribe / do-not-contact request
- out-of-office

A human recruiter reply must stop automated follow-ups for that contact/job until an explicit future action is scheduled.

### 8. Durable Audit Trail

Every discovery, ranking decision, safety decision, send attempt, provider response, follow-up, reply, bounce, and suppression event must be persisted.

This makes the system recoverable after crashes and allows investigation of exactly why a message was or was not sent.

## Database model

Add a dedicated recruiter-outreach schema rather than overloading application-attempt rows.

### recruiter_contacts

- id
- company_id / normalized company key
- company_name
- company_domain
- email
- full_name
- first_name
- last_name
- job_title
- department
- seniority
- source_provider
- source_confidence
- verification_status
- verification_score
- source_urls JSONB
- discovered_at
- verified_at
- last_seen_at
- status

Unique identity should normalize email to lowercase and trim whitespace.

### recruiter_contact_sources

- recruiter_contact_id
- provider
- source_url
- source_type
- confidence
- first_seen_at
- last_seen_at

This preserves provenance instead of storing only a score.

### recruiter_outreach_sequences

- id
- application_id
- candidate_profile_id
- recruiter_contact_id
- status
- current_step
- next_action_at
- started_at
- stopped_at
- stop_reason
- created_at
- updated_at

Important uniqueness:

```text
(application_id, recruiter_contact_id)
```

This prevents duplicate outreach to the same recruiter for the same application.

### recruiter_outreach_messages

- id
- sequence_id
- step
- direction (OUTBOUND/INBOUND)
- provider
- provider_message_id
- provider_thread_id
- subject
- body_text
- body_html
- status
- sent_at
- delivered_at when available
- failure_code
- failure_message
- created_at

### recruiter_suppressions

- id
- normalized_email nullable
- normalized_domain nullable
- company key nullable
- reason
- source
- created_at
- expires_at nullable

A contact-level opt-out should always override future automated sends.

### recruiter_discovery_runs

- id
- application_id nullable
- company key
- domain
- provider
- status
- contacts_found
- credits/usage metadata when available
- error_code
- error_message
- started_at
- completed_at

This prevents repeated expensive provider searches and gives operational visibility.

## Queue topology

Use separate task types:

```text
APPLY_JOB
   |
   +--> APPLICATION_OUTCOME_RECORDED
              |
              +--> DISCOVER_RECRUITERS
                         |
                         +--> PREPARE_RECRUITER_OUTREACH
                                    |
                                    +--> SEND_RECRUITER_EMAIL
                                               |
                                               +--> SCHEDULE_RECRUITER_FOLLOWUP

GMAIL_SYNC
   |
   +--> PROCESS_RECRUITER_REPLIES
             |
             +--> STOP_SEQUENCE / UPDATE_CONTACT
```

The discovery task should be idempotent. Sending should use a reservation/idempotency boundary so a worker crash cannot cause the same message to be sent twice after recovery.

## Application integration

`ApplicationTaskHandler` should not directly perform recruiter API calls or send mail.

Instead, after `ApplicationSubmissionService.submit()` returns and the application attempt is recorded, enqueue a recruiter outreach orchestration task containing:

- application ID
- job opportunity ID
- candidate profile ID
- company name
- job title
- application URL
- ATS result: submitted/blocked/failed
- safety reason
- confirmation URL if available

This guarantees recruiter outreach is triggered for both successful and unsuccessful website application attempts.

The task should only be enqueued after the application has passed the existing eligibility/exclusion checks. Permanent excluded companies remain excluded from both application and recruiter outreach.

## Provider abstraction

```ts
interface RecruiterDiscoveryProvider {
  readonly name: string;
  discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult>;
  verify(email: string): Promise<RecruiterVerificationResult>;
}
```

Provider adapters should be independently rate-limited and observable.

The system should not assume that one provider will find every recruiter. A provider returning zero results is a normal outcome, not a workflow failure.

## Email identity and threading

Gmail OAuth should be used with the smallest practical scope for sending and, separately, mailbox synchronization. Gmail supports `gmail.send` for sending and OAuth server-side flows for offline access. The system should preserve the Gmail provider message/thread identifiers so follow-ups can continue the same conversation when appropriate.

The sender must never spoof a recruiter or company address.

## Rate limiting

Recruiter outreach needs limits independent of ATS application limits.

At minimum:

- messages per hour
- messages per day
- messages per company per day
- contacts per company per application
- discovery requests per provider/minute
- verification requests per provider/minute
- follow-ups per day

The first production rollout should use deliberately small limits and increase only after observing delivery quality and reply behavior.

## Data quality rules

Never send solely because an email exists.

Recommended minimum send score:

```text
email valid                         + required
company-domain match                + required
professional/non-disposable         + required
verification acceptable             + required
recruiter/title relevance           + weighted
source confidence                   + weighted
recency                             + weighted
```

If no named recruiter clears the threshold, the system may optionally use a verified generic recruiting/careers address if policy allows it. It must not invent an address.

## Compliance and reputation guardrails

The system should be designed for one candidate's targeted professional outreach, not bulk spam.

Operational safeguards:

- maintain a permanent suppression list
- process unsubscribe/do-not-contact requests
- never use purchased or harvested lists as a shortcut
- prefer publicly available professional contact data from supported providers
- verify addresses before sending when supported
- keep sender identity accurate
- keep volume low and configurable
- record provenance for discovered contacts
- never use dictionary attacks to generate addresses
- never bypass CAPTCHAs or access controls to discover contacts
- provide a global kill switch
- keep recruiter outreach disabled by default until credentials, sender identity, and safety settings are reviewed

Where messages are subject to commercial-email rules, the message template and sender configuration must support applicable identification, address, and opt-out requirements. Jurisdiction-specific legal review should be performed before materially increasing outreach volume.

## Configuration

Add configuration behind safe defaults:

```env
RECRUITER_OUTREACH_ENABLED=false
RECRUITER_OUTREACH_DRY_RUN=true
RECRUITER_DISCOVERY_PROVIDER=hunter
HUNTER_API_KEY=
RECRUITER_MIN_CONFIDENCE=80
RECRUITER_REQUIRE_VERIFIED_EMAIL=true
RECRUITER_MAX_CONTACTS_PER_APPLICATION=3
RECRUITER_MAX_MESSAGES_PER_DAY=10
RECRUITER_MAX_MESSAGES_PER_HOUR=3
RECRUITER_FOLLOWUP_ENABLED=false
RECRUITER_FOLLOWUP_DAY_OFFSETS=4,10,18
RECRUITER_GENERIC_EMAIL_FALLBACK=true
```

Secrets remain in `.env` and are never committed.

## Rollout phases

### Phase A — foundation

- domain/company normalization
- recruiter contact types
- provider interfaces
- database migration
- repository layer
- discovery task
- configuration and feature flags
- tests for deduplication and exclusions

### Phase B — Hunter integration

- Hunter Domain Search adapter
- verification adapter
- provider usage/rate limiting
- provenance persistence
- recruiter ranking
- integration tests using mocked provider responses

### Phase C — outreach preparation

- recruiter message templates
- deterministic personalization
- outreach safety gate
- dry-run reporting
- message persistence
- idempotent send reservation

### Phase D — Gmail sending

- Gmail OAuth sender using existing Gmail infrastructure
- thread/message ID persistence
- send retry policy
- sender identity validation
- hard daily/hourly limits

### Phase E — follow-ups and replies

- durable follow-up sequence
- Gmail reply correlation
- bounce classification
- opt-out/suppression handling
- automatic sequence cancellation

### Phase F — production hardening

- dashboards/metrics
- provider failure isolation
- stale sequence recovery
- audit reports
- kill switch
- end-to-end dry-run tests
- controlled real-world validation with one job at a time

## Acceptance criteria

The feature is complete only when all of the following are true:

1. A successful ATS application creates recruiter discovery work.
2. A blocked/failed ATS application also creates recruiter discovery work.
3. Permanent excluded companies create neither application nor recruiter outreach.
4. The same recruiter cannot receive duplicate outreach for the same application.
5. The same application cannot create duplicate discovery sequences after worker recovery.
6. Invalid/unverified contacts are blocked according to policy.
7. Recruiter replies stop scheduled follow-ups.
8. Opt-out requests create durable suppression.
9. Provider outages do not corrupt application state.
10. Browser automation never needs recruiter discovery to succeed.
11. Outreach can be globally disabled immediately.
12. Dry-run mode proves the entire discovery/ranking/composition path without sending mail.
13. Every send has an auditable provider message ID or a durable failure record.
14. Existing application tests remain green.
15. Real sending remains disabled until explicit configuration and final safety review.

## Current implementation alignment

The repository already has:

- durable task queues
- application attempt persistence
- application submission safety controls
- Gmail OAuth/mailbox synchronization
- candidate profile resolution
- application email abstractions
- follow-up scheduling
- PostgreSQL migrations

Recruiter outreach should therefore be implemented as a new bounded domain around those existing primitives, not as logic embedded in browser automation or the main runtime loop.
