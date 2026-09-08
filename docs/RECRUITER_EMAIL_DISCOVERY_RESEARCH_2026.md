# Recruiter Email Discovery and Outreach Research 2026

## Executive findings

The highest-value recruiter discovery strategy is not one provider. It is a layered pipeline that combines:

1. **First-party company sources** — job descriptions, company home page, careers/jobs pages, recruiting/talent pages, contact pages, and same-domain sitemap URLs.
2. **Professional email-data providers** — Hunter and Snov when configured, with verification required before normal provider-derived outreach.
3. **Strong ranking** — technical/engineering recruiters and talent-acquisition roles should outrank generic HR contacts.
4. **Permanent deduplication** — the same recruiter + opportunity + candidate must never receive a duplicate sequence.
5. **Suppression and rate limits** — unsubscribe/suppression, hourly limits, daily limits, and atomic database claiming must remain in front of every send.
6. **Resume attachment on initial outreach** — the configured candidate resume is attached to the first recruiter message only; follow-ups do not resend it.

The system deliberately does **not** scrape Google/Bing search results or bypass login/CAPTCHA/private recruiter systems. Google documents machine-generated automated queries as a prohibited search-spam practice, so discovery stays on first-party public pages and supported APIs instead.

## Evidence and provider capabilities

### Hunter

Hunter's current documentation says Domain Search returns emails found from public web sources and exposes source information; Email Finder can find a professional email from a full name plus company/domain. Hunter also distinguishes publicly sourced addresses from inferred addresses. This makes Hunter useful for domain-level recruiter discovery, but the application should still require a valid/verified status before treating a provider-derived contact as safe for automated outreach.

Source: https://help.hunter.io/en/articles/15921145-faqs-about-finding-emails-in-hunter
Source: https://help.hunter.io/en/articles/1844277-email-finder-find-the-email-of-a-specific-person

### Snov.io

Snov's domain-search workflow can return prospects by recruiting-related positions and then discover/verify email addresses. The current implementation uses recruiter-oriented positions and checks SMTP/verification status before accepting contacts.

### Apollo

Apollo's current API can search people by organization domain, job title, seniority, and email status. Its people search endpoint does not itself return email addresses; a follow-up people-enrichment call can reveal an email and verification status. Apollo's enrichment endpoint can consume credits, so it should remain an **optional** provider rather than an unconditional dependency. Apollo also documents a literal placeholder for unrevealed email in some person endpoints; the application must never mistake that placeholder for a real address.

Sources:
- https://docs.apollo.io/reference/people-api-search
- https://docs.apollo.io/reference/people-enrichment
- https://docs.apollo.io/reference/bulk-people-enrichment
- https://docs.apollo.io/reference/get-complete-person-info

### First-party public company sources

Public recruiter addresses are frequently exposed on company careers pages, job descriptions, contact pages, and recruiting/talent pages. The implementation now checks multiple conventional paths and follows same-domain sitemap URLs that look recruitment-related. It also recognizes normal emails, `mailto:` links, and common public obfuscations such as `name [at] company [dot] com`.

The public-source extractor only accepts addresses on the employer's normalized domain and rejects technical support, sales, billing, legal, privacy, security, and similar non-recruiting contexts. Generic aliases such as `careers@`, `jobs@`, `talent@`, `recruiting@`, and `hr@` are accepted when their mailbox name itself is a strong recruiting signal.

This is intentionally narrow: it is public first-party contact discovery, not arbitrary personal-data scraping.

## Employer-domain normalization

ATS pages commonly use domains such as `boards.greenhouse.io`, `jobs.lever.co`, or `jobs.ashbyhq.com`. These are blocked as employer domains. Conversely, company careers pages can use `careers.example.com`, `jobs.example.com`, or `apply.example.com`; the domain resolver now normalizes these to the employer domain where possible.

Common two-part public suffixes such as `co.in` and `co.uk` are handled so `careers.example.co.in` resolves to `example.co.in` rather than `co.in`.

## Contact quality model

Recruiter contacts are ranked using multiple signals:

- technical recruiter title
- engineering recruiter title
- talent acquisition partner/specialist/manager
- recruiter/talent acquisition
- hiring manager
- recruiting-related department
- seniority signals such as manager, partner, director, head, VP
- verified email status
- provider confidence
- explicit job-posting source
- first-party company-page source
- multiple independent public sources
- recruiting mailbox aliases
- alignment with engineering/frontend/software job titles

The ranking intentionally prefers a relevant human recruiter over a generic HR address when both are available, while retaining a generic recruiting mailbox as a fallback.

## Verification policy

Provider-derived addresses from Hunter/Snov are only eligible when verified under the configured verification policy. Public job-posting/company-page addresses are a narrowly scoped exception because they are explicit first-party recruiting contacts; they are persisted as `unverified_public_source` and remain distinguishable in the database.

No provider is allowed to silently turn an arbitrary unverified address into an automated recipient.

## Outreach and deliverability

The Gmail API requires an RFC 2822/MIME message encoded into the `raw` field for `users.messages.send`. Multipart MIME is the correct mechanism for attachments. The implementation now builds a `multipart/mixed` message containing the plain-text recruiter message plus the candidate resume as a PDF attachment.

Google's current Gmail documentation confirms that messages with attachments are represented as multipart MIME messages and sent as base64URL-encoded `raw` messages.

Sources:
- https://developers.google.com/workspace/gmail/api/guides/sending
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
- https://developers.google.com/workspace/gmail/api/guides/uploads

The application uses a conservative 10 MB resume attachment safety limit even though Gmail's overall message limit is higher. The resume is attached to the **INITIAL** recruiter message only; scheduled follow-ups omit the attachment.

## Anti-spam / compliance guardrails

The system must not turn recruiter discovery into uncontrolled bulk mail. It retains:

- permanent opportunity/contact sequence deduplication
- recipient and domain suppression
- atomic hourly/daily rate-limit claiming
- live-activation confirmation
- Gmail OAuth authentication
- failure tracking
- inbound reply processing
- follow-up scheduling

For commercial outreach, applicable rules can impose requirements around accurate sender/subject information and opt-out handling. The system therefore treats suppression as a first-class state and should not send to a recruiter after an explicit opt-out.

## Current implemented architecture

```text
MATCH_JOB
   |
   +--------------------+---------------------+
   |                                          |
   v                                          v
APPLY_JOB                              DISCOVER_RECRUITERS
                                               |
                                               v
                                  Employer-domain normalization
                                               |
                       +-----------------------+-----------------------+
                       |                       |                       |
                       v                       v                       v
                Job description       First-party company      Hunter/Snov
                                      pages + sitemap           (optional)
                       |                       |                       |
                       +-----------------------+-----------------------+
                                               |
                                               v
                                      Candidate deduplication
                                               |
                                               v
                                         Contact ranking
                                               |
                                               v
                                     Verification/safety gate
                                               |
                                               v
                                      PREPARE_OUTREACH
                                               |
                                               v
                                        SEND_RECRUITER_EMAIL
                                               |
                                               +--> initial + resume PDF
                                               |
                                               v
                                        Gmail API / MIME
                                               |
                                               v
                                     SENT + Gmail message ID
                                               |
                                               v
                                        Follow-up scheduler
```

## Practical limits and remaining opportunities

No public source can guarantee a recruiter email for every company. Some companies expose no recruiter address, some use only ATS forms, and some recruiter information is behind private systems. The correct behavior in those cases is to retain the opportunity and fall back to the application route rather than inventing or guessing an address.

Apollo is a strong optional extension because its current API can search people by company domain and title and then enrich selected people, but it should be enabled only when the account/API key and credit policy are intentionally configured.

The current public-page implementation intentionally uses a bounded set of first-party URLs and bounded sitemap expansion rather than crawling the entire web.

## Sources

1. Hunter Help Center — Finding emails and Domain Search: https://help.hunter.io/en/articles/15921145-faqs-about-finding-emails-in-hunter
2. Hunter Help Center — Email Finder: https://help.hunter.io/en/articles/1844277-email-finder-find-the-email-of-a-specific-person
3. Apollo Docs — People API Search: https://docs.apollo.io/reference/people-api-search
4. Apollo Docs — People Enrichment: https://docs.apollo.io/reference/people-enrichment
5. Apollo Docs — Bulk People Enrichment: https://docs.apollo.io/reference/bulk-people-enrichment
6. Apollo Docs — Complete Person Info: https://docs.apollo.io/reference/get-complete-person-info
7. Google Developers — Gmail sending: https://developers.google.com/workspace/gmail/api/guides/sending
8. Google Developers — Gmail messages.send: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
9. Google Developers — Gmail attachment uploads: https://developers.google.com/workspace/gmail/api/guides/uploads
10. Google Search Central — Spam policies: https://developers.google.com/search/docs/essentials/spam-policies
11. FTC — CAN-SPAM Rule overview: https://www.ftc.gov/news-events/news/press-releases/2019/02/ftc-completes-review-can-spam-rule
