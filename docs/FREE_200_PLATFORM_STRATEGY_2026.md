# Free-first 200-platform discovery strategy (2026)

## Objective

Maximize job coverage without making a paid aggregator a hard dependency. The important unit is a **usable job opportunity**, not the number of vendor integrations.

The project therefore uses four layers:

1. Free/public APIs and RSS/Atom feeds.
2. Public ATS job boards (Greenhouse, Lever, Ashby) and configurable ATS adapters where a company board URL/slug is known.
3. Public JobPosting structured data from career pages.
4. Public recruiter-contact discovery so a matched role can still produce a recruiter-email path when direct application is unavailable.

## Research basis

- Greenhouse's public Job Board API exposes published jobs without authentication; its application POST endpoint is authenticated. This makes Greenhouse excellent for discovery and a separate path for application submission. See the official Greenhouse Job Board API documentation.
- Lever's public postings API exposes published postings and supports programmatic applications when the employer's account provides the required application API key. Public postings can therefore be discovered without a paid aggregator.
- Current open-source job aggregation projects demonstrate that 100+ public job sources can be normalized through APIs, RSS/Atom feeds, and public career pages. We use this as an architecture reference, not as a dependency and not as permission to bypass protected sites.
- Public feed examples verified during research include Python.org Jobs, LaraJobs, FOSS Jobs, Jobspresso, HasJob, Golang Projects, VueJobs, Landing.jobs, We Work Remotely, and other RSS/Atom sources.

## What "200 platforms" means here

The repository already maintains a 200+ platform catalog in `JobPlatformRegistry.ts`. That catalog is routing/coverage metadata; it is deliberately **not** represented as 200 fake scrapers.

A platform becomes active only when one of these is available:

- a public feed/API;
- a supported ATS board URL/identifier;
- a public structured-data career page;
- or an explicitly configured adapter.

This avoids generating empty jobs from dead URLs and avoids violating login/CAPTCHA/private-API boundaries.

## Free public feed federation

`FreePublicJobFeedBundleSource` now fans out across a maintained set of public RSS/Atom job feeds. Each feed is isolated with `Promise.allSettled`, so a broken feed does not stop discovery from the other sources.

The bundle currently includes public feeds for:

- We Work Remotely (general + frontend)
- Python.org Jobs
- LaraJobs
- FOSS Jobs
- Jobspresso
- HasJob
- Golang Projects
- VueJobs
- Landing.jobs remote
- I Love Remote
- Freelancer

The existing Remote OK, Himalayas, Jobicy, Arbeitnow and other direct sources remain enabled separately.

## Email-first outcome

The pipeline no longer waits for an application before recruiter discovery. `MATCH_JOB` fans out to `APPLY_JOB` and `DISCOVER_RECRUITERS` as sibling tasks.

Recruiter discovery now checks:

- the job description; and
- public company pages at `/`, `/careers`, `/career`, `/jobs`, `/join-us`, and `/contact`.

Only company-domain email addresses with explicit recruiting/hiring/talent/HR context are accepted. Technical support, sales, billing, legal, security, and similar addresses are rejected.

This means a role can still reach the recruiter-outreach pipeline when the application form is unavailable or unsafe to automate.

## Safety and quality rules

- Never bypass login, CAPTCHA, anti-bot controls, or private APIs.
- Never use a paid aggregator as a required runtime dependency.
- Keep permanent application deduplication.
- Keep the permanent excluded-company guard.
- Keep Bengaluru/India/remote prioritization in matching.
- A recruiter email is not considered verified merely because it was found publicly; the current provider labels it `unverified_public_source` and the existing outreach activation/verification policy remains authoritative.
- Application and recruiter branches are independent; application failure must not suppress recruiter outreach.

## Important API-cost notes

Adzuna and Jooble remain optional. Adzuna documents request limits and usage terms; Jooble documents a free API plan with a lifetime request quota. They are not required for the free-first path. Techmap is also optional and is not required for discovery.
