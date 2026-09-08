# Job-source expansion

The project keeps the requested 200-platform catalog in `JobPlatformRegistry` and now supports a generic public-web discovery adapter in addition to API, RSS, and ATS adapters.

## Source capabilities

- **API**: machine-readable public job feeds already supported by the runtime.
- **RSS**: public feeds with deterministic parsing.
- **ATS**: Greenhouse, Lever, and Ashby are directly implemented; additional ATS application adapters are handled separately where available.
- **web / structured-data**: public pages exposing Schema.org `JobPosting` JSON-LD can now be ingested without a site-specific scraper.
- **catalog-only**: a platform is listed for coverage tracking but is not falsely represented as an active scraper.

## Web safety

The generic web adapter only performs normal public HTTP requests. It does not log in, solve CAPTCHAs, bypass access controls, evade anti-bot systems, or use private APIs. A source must explicitly provide a public URL in `JOB_SOURCES` using `type: "web"` or `type: "structured-data"`.

Example:

```json
[
  {
    "id": "example:web",
    "type": "web",
    "name": "Example Jobs",
    "url": "https://example.com/jobs",
    "status": "APPROVED"
  }
]
```

The adapter extracts `JobPosting` JSON-LD and normalizes it into the same `Job` model used by the existing discovery pipeline, so deduplication, matching, ranking, and application policy remain unchanged.

The 200-name registry is intentionally not converted into 200 fake URLs. Platforms that require login, protected APIs, proprietary access, or site-specific browser flows remain catalog entries until a legitimate public integration is available.
