# Broad Job Discovery Coverage

The discovery layer now uses three levels of coverage rather than pretending every job platform exposes the same interface.

## 1. Direct public sources

The existing runtime continues to use public APIs/RSS feeds and public ATS job-board endpoints such as Remote OK, Himalayas, Jobicy, Arbeitnow, We Work Remotely, Greenhouse, Lever and Ashby.

Greenhouse documents public GET job-board endpoints without authentication; authentication is required for application submission. Lever similarly exposes published postings through its public Postings API. This keeps discovery separate from application credentials.

## 2. Broad normalized aggregation

`TechmapJobSource` integrates the Techmap Job Postings API through RapidAPI. Techmap currently documents coverage of 195+ sources and a normalized JSON schema for job title, description, company, location, employment type, workplace and source. This lets the project cover platforms that do not expose a suitable public API of their own without implementing prohibited login/CAPTCHA/private-API bypasses.

The default portal set includes verified current Techmap portal identifiers for:

- Naukri
- LinkedIn
- Shine
- Foundit
- Hirist
- Recruitee
- Workable
- Taleo
- StepStone
- InfoJobs
- JobCloud
- Recooty
- Eploy
- Deel
- Workstream
- JOIN
- JobAps
- Arbeitsagentur
- EURES
- SEEK
- Techmap

The adapter also supports a global mode by omitting `portal`, allowing the aggregator's entire indexed corpus to be queried. Use portal filters for quota-efficient operation.

## 3. Additional first-class APIs

### Adzuna

Adzuna's official API uses an `app_id` and `app_key`, with country-specific job search endpoints. The integration supports multiple title queries, locations and pagination. India is the default country configuration and Bengaluru is the default location.

### Jooble

Jooble's current REST API is regional: an API key generated for one country domain cannot be used to query another country's listings. The integration therefore makes the API base URL configurable and defaults to the India endpoint. The current Jooble documentation also states that its free API plan has a 500-request lifetime limit per key, so this source must not be polled aggressively.

## Safety and operating model

- No login automation is added to discovery.
- No CAPTCHA bypass is added.
- No private/internal API endpoints are assumed.
- API keys remain environment variables and are never committed.
- Optional paid/credentialed sources activate only when credentials exist.
- Existing deduplication, matching, excluded-company and application safety policies remain authoritative.
- Discovery failures are isolated at the source-run layer rather than turning unsupported platforms into fake successful sources.

## Recommended coverage for India-first search

The default Techmap filters prioritize Bengaluru and React/Frontend/Next.js/TypeScript signals. Matching still remains authoritative, so discovery may retrieve broader jobs and the existing matcher/ranking pipeline decides eligibility.

This is intentionally broader than the original 12-source runtime while avoiding unsupported scraping claims.
