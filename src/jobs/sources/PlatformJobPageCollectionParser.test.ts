import { parsePlatformJobPageCollection } from "./PlatformJobPageCollectionParser";

describe("PlatformJobPageCollectionParser", () => {
  it("extracts multiple JobPosting JSON-LD records from one array", () => {
    const html = `<script type="application/ld+json">${JSON.stringify([
      { "@type": "JobPosting", title: "React Engineer", description: "Build React applications", hiringOrganization: { name: "Acme One" }, url: "https://jobs.example/1" },
      { "@type": "JobPosting", title: "Frontend Engineer", description: "Build frontend applications", hiringOrganization: { name: "Acme Two" }, url: "https://jobs.example/2" }
    ])}</script>`;
    const result = parsePlatformJobPageCollection(html, "https://jobs.example/search", "Example Board");
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.map((job) => job.companyName)).toEqual(["Acme One", "Acme Two"]);
  });

  it("extracts multiple JobPosting records from @graph", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ "@graph": [
      { "@type": "WebPage" },
      { "@type": "JobPosting", title: "React Developer", description: "React role", hiringOrganization: { name: "Acme" }, url: "https://jobs.example/3" },
      { "@type": "JobPosting", title: "Next.js Developer", description: "Next.js role", hiringOrganization: { name: "Beta" }, url: "https://jobs.example/4" }
    ]})}</script>`;
    const result = parsePlatformJobPageCollection(html, "https://jobs.example/search", "Example Board");
    expect(result.jobs).toHaveLength(2);
  });

  it("extracts explicit application-state job records without inventing an employer", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { jobs: [
      { title: "React Developer", description: "Real role", company: { name: "Gamma" }, url: "https://jobs.example/5" },
      { title: "Shell Listing", description: "No company" }
    ] } } })}</script>`;
    const result = parsePlatformJobPageCollection(html, "https://jobs.example/search", "Example Board");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.companyName).toBe("Gamma");
  });
});
