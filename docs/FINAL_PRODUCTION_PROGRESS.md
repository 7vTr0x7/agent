# Job Agent — Final Production Progress Tracker

Last updated: 2026-09-29

## Status map

| Phase | Area | Status | Evidence / next gate |
|---|---|---|---|
| 1 | Safety/runtime gates | DONE | CI hardening verifies automation=false, application dry-run=true, live application/Gmail/outbound/proactive-send=false. |
| 2 | Typecheck/build | DONE | Latest CI run passed both typecheck and build. |
| 3 | Core unit/integration suite | IN PROGRESS | 988/993 tests passed on latest CI; one suite failed because its expectation still capped federated search URLs. |
| 4 | Search-provider fan-out | DONE | Platform search profiles intentionally combine first-party URLs with every configured public-search provider; the failing test exposed an obsolete 4-URL assertion. |
| 5 | Federation/platform coverage | IN PROGRESS | Existing registry/federation implementation is present and exercised; final real-data coverage report remains required. |
| 6 | Relevance-before-persistence | DONE (code path) | Discovery tests exercise relevance metrics and persistence after policy evaluation; final live DB reconciliation remains required. |
| 7 | Geography/seniority/full-stack matching | DONE (tested) | Eligibility, ranking, semantic matching, and runtime regression suites pass in latest CI. |
| 8 | LinkedIn/public hiring evidence | DONE (code/test) | LinkedIn hiring-post provider and email matcher suites pass; real-data acceptance remains required. |
| 9 | Recruiter/contact discovery | DONE (code/test) | Recruiter discovery, identity, relevance, email enrichment, and outreach preparation suites pass; real-data acceptance remains required. |
| 10 | Application dry-run | DONE (code/test) | Application task/workflow suites pass; real discovered APPLY candidate acceptance remains required. |
| 11 | Outreach dry-run | DONE (code/test) | Outreach pipeline/activation/send-gate suites pass; real evidence acceptance remains required. |
| 12 | Database reconciliation | PENDING | Must run safe cleanup/reconciliation against local PostgreSQL and verify relevant-only active jobs. |
| 13 | Real-data concurrent runtime | PENDING | Must run local discovery workers with all five workstreams enabled concurrently while external side effects remain disabled. |
| 14 | API/dashboard evidence | PENDING | Verify runtime counts and representative records after real run. |
| 15 | Final CI | IN PROGRESS | Fix obsolete platform-fallback test, then rerun required checks until green. |
| 16 | Live readiness | BLOCKED BY GATES | Do not enable live applications/outbound/Gmail until real-data dry-run acceptance and CI are green. |

## Current blocker

Latest GitHub CI failed only on `src/jobs/sources/PlatformSearchJobSource.platform-fallback.test.ts`: implementation now returns first-party URLs **plus** public-search-provider URLs, while the test still expected exactly four URLs. The test has been corrected to assert the first-party URLs are present without imposing a provider-count ceiling.

## Safety lock for local acceptance

```text
AUTOMATION_ENABLED=false
APPLICATION_DRY_RUN=true
APPLICATION_LIVE_ENABLED=false
OUTBOUND_ENABLED=false
GMAIL_ENABLED=false
RECRUITER_OUTREACH_ENABLED=false
RECRUITER_OUTREACH_DRY_RUN=true
```

## Completion rule

A phase moves to DONE only after observable evidence exists. No counts are marked complete from configuration or catalog size alone. Final completion requires green required CI plus a real local dry-run with relevant jobs, hiring evidence, qualified contacts, application dry-run evidence, and outreach dry-run evidence.
