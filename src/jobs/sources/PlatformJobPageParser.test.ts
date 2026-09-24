import { parseCutshortListingPage, parsePlatformJobPage } from "./PlatformJobPageParser";

describe("PlatformJobPageParser", () => {
  it("finds nested JobPosting inside @graph and arrays", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["Thing","JobPosting"],"title":"React Engineer","description":"Build React applications","hiringOrganization":{"@type":"Organization","name":"Acme","sameAs":"https://acme.example/jobs"},"jobLocation":{"address":{"addressLocality":"Bengaluru","addressCountry":"India"}}}]}</script>`;
    const result = parsePlatformJobPage(html, "https://jobs.example/acme", "Example Board");
    expect(result.job?.title).toBe("React Engineer");
    expect(result.job?.companyName).toBe("Acme");
    expect(result.job?.companyDomain).toBe("acme.example");
    expect(result.diagnostics.parser).toBe("json-ld");
  });


  it("parses a Cutshort public job detail page without structured data", () => {
    const html = `
      <html>
        <head><link rel="canonical" href="https://cutshort.io/job/Full-Stack-Engineer-Frontend-Focus-Bengaluru-Auxo-fkTnz"></head>
        <body>
          <h1>Full Stack Engineer (Frontend Focus)</h1>
          <h2>at <a href="/company/auxo-ai">Auxo AI</a></h2>
          <div>3 - 10 yrs</div>
          <div>₹10L - ₹55L / yr</div>
          <div>Location : Hyderabad/Bangalore/Gurgaon/Mumbai</div>
          <div>Skills</div>
          <div>React.js NextJs (Next.js) TypeScript Javascript RESTful APIs NodeJS (Node.js)</div>
          <h3>Role Summary</h3>
          <p>We're looking for a Full Stack Engineer with a frontend focus to build React and Next.js applications.</p>
          <p>Minimum Qualifications: 3–7 years of software engineering experience. Strong experience with React, Next.js, TypeScript and JavaScript.</p>
          <h3>Users love Cutshort</h3>
        </body>
      </html>`;
    const result = parsePlatformJobPage(html, "https://cutshort.io/job/Full-Stack-Engineer-Frontend-Focus-Bengaluru-Auxo-fkTnz", "Cutshort");
    expect(result.job).not.toBeNull();
    expect(result.job).toMatchObject({
      title: "Full Stack Engineer (Frontend Focus)",
      companyName: "Auxo AI",
      location: "Hyderabad/Bangalore/Gurgaon/Mumbai",
      country: "India",
      workplaceType: "onsite"
    });
    expect(result.job?.description).toContain("React and Next.js");
    expect(result.diagnostics.parser).toBe("html-labels");
  });


  it("extracts multiple real Cutshort listing cards into job opportunities", () => {
    const html = `
      <html><body>
        <h1>96 NextJs (Next.js) Jobs in Bangalore (Bengaluru)</h1>
        <section class="job-card">
          <a href="/job/ReactJS-Developer-Bengaluru-appscrip-abc123">ReactJS Developer</a>
          <h3>at appscrip</h3>
          <div>Bengaluru (Bangalore)</div>
          <div>0 - 1.5 years</div>
          <div>React.js HTML/CSS NextJs (Next.js) Javascript</div>
          <div>NEED TO HAVE: Have some knowledge of front end like React.JS. Strong in JavaScript concepts.</div>
        </section>
        <section class="job-card">
          <a href="/job/Full-Stack-Developer-Bengaluru-Vivtaa-xyz789">Full Stack Developer</a>
          <h3>at Vivtaa Technology</h3>
          <div>Bengaluru (Bangalore)</div>
          <div>3 - 6 years</div>
          <div>React.js NodeJS (Node.js) React Native NextJs (Next.js)</div>
          <div>What we need: Experience in both Web + Mobile development. Build responsive web applications using React.js / Next.js.</div>
        </section>
      </body></html>`;
    const jobs = parseCutshortListingPage(html, "https://cutshort.io/jobs/nextjs-next-js-jobs-in-bangalore-bengaluru");
    expect(jobs).toHaveLength(2);
    expect(jobs.map(job => job.companyName)).toEqual(expect.arrayContaining(["appscrip", "Vivtaa Technology"]));
    expect(jobs[0]?.location).toContain("Bengaluru");
    expect(jobs[0]?.country).toBe("India");
    expect(jobs.some(job => /ReactJS Developer/.test(job.title))).toBe(true);
    expect(jobs.some(job => /Full Stack Developer/.test(job.title))).toBe(true);
  });

  it("uses applicant location requirements instead of inventing Worldwide", () => {
    const html = `<script type="application/ld+json">{"@type":"JobPosting","title":"Frontend Engineer","description":"Build React apps","hiringOrganization":{"name":"Acme"},"jobLocationType":"TELECOMMUTE","applicantLocationRequirements":{"@type":"Country","name":"India"}}</script>`;
    const result = parsePlatformJobPage(html, "https://jobs.example/acme/remote", "Example Board");
    expect(result.job?.location).toBe("India");
    expect(result.job?.country).toBe("India");
    expect(result.job?.workplaceType).toBe("remote");
  });

  it("keeps genuinely missing geography unknown", () => {
    const html = `<script type="application/ld+json">{"@type":"JobPosting","title":"Frontend Engineer","description":"Build React apps","hiringOrganization":{"name":"Acme"}}</script>`;
    const result = parsePlatformJobPage(html, "https://jobs.example/acme/unknown", "Example Board");
    expect(result.job?.location).toBeNull();
    expect(result.job?.workplaceType).toBeNull();
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
