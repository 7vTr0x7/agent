import { parsePlatformJobPage } from "./PlatformJobPageParser";

describe("PlatformJobPageParser", () => {
  it("finds nested JobPosting inside @graph and arrays", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["Thing","JobPosting"],"title":"React Engineer","description":"Build React applications","hiringOrganization":{"@type":"Organization","name":"Acme","sameAs":"https://acme.example/jobs"},"jobLocation":{"address":{"addressLocality":"Bengaluru","addressCountry":"India"}}}]}</script>`;
    const result = parsePlatformJobPage(html, "https://jobs.example/acme", "Example Board");
    expect(result.job?.title).toBe("React Engineer");
    expect(result.job?.companyName).toBe("Acme");
    expect(result.job?.companyDomain).toBe("acme.example");
    expect(result.diagnostics.parser).toBe("json-ld");
  });

  it("extracts jobs from Next.js embedded state when JSON-LD is absent", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"job":{"title":"Frontend Developer","description":"React and TypeScript role","company":{"name":"Bright Labs","url":"https://bright.example"},"location":"Bangalore, India"}}}}</script>`;
    const result = parsePlatformJobPage(html, "https://board.example/jobs/1", "Example Board");
    expect(result.job?.companyName).toBe("Bright Labs");
    expect(result.job?.location).toContain("Bangalore");
    expect(result.diagnostics.parser).toBe("embedded-state");
  });

  it("extracts Schema.org JobPosting microdata when JSON-LD is absent", () => {
    const html = `<div itemscope itemtype="https://schema.org/JobPosting"><h1 itemprop="title">Frontend Engineer</h1><div itemprop="description">Build React and TypeScript applications for the product team.</div><div itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization"><span itemprop="name">Bright Labs</span></div><div itemprop="jobLocation">Bengaluru, India</div><span itemprop="employmentType">FULL_TIME</span></div>`;
    const result = parsePlatformJobPage(html, "https://board.example/jobs/2", "Example Board");
    expect(result.job?.title).toBe("Frontend Engineer");
    expect(result.job?.companyName).toBe("Bright Labs");
    expect(result.job?.location).toContain("Bengaluru");
    expect(result.diagnostics.parser).toBe("microdata");
  });

  it("uses explicit employer metadata but never platform/site name", () => {
    const html = `<meta property="og:title" content="React Engineer"><meta property="og:description" content="React role"><meta property="job:company" content="Acme Corp">`;
    const result = parsePlatformJobPage(html, "https://board.example/jobs/3", "Example Board");
    expect(result.job?.companyName).toBe("Acme Corp");
  });

  it("rejects pages without an explicit employer instead of guessing", () => {
    const html = `<title>React Engineer - Example Board</title><meta name="description" content="Great React role at an undisclosed company">`;
    const result = parsePlatformJobPage(html, "https://board.example/jobs/4", "Example Board");
    expect(result.job).toBeNull();
    expect(result.diagnostics.failure).toBe("no-structured-data");
  });
});
