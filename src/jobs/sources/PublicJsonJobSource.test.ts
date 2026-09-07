import { PublicJsonJobSource } from "./PublicJsonJobSource";

describe("PublicJsonJobSource", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("normalizes Himalayas jobs", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      jobs: [{
        guid: "h-1",
        title: "Frontend Engineer",
        companyName: "Example India",
        applicationLink: "https://himalayas.app/jobs/h-1",
        locationRestrictions: ["India"],
        employmentType: "Full Time",
        description: "<p>React and TypeScript</p>",
        pubDate: "2026-09-07T08:00:00Z"
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const jobs = await new PublicJsonJobSource("himalayas", "https://himalayas.app/jobs/api").fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "himalayas:json",
      sourceJobId: "h-1",
      title: "Frontend Engineer",
      companyName: "Example India",
      country: "India",
      workplaceType: "remote",
      description: "React and TypeScript"
    });
  });

  it("normalizes Jobicy jobs", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      jobs: [{
        id: "j-1",
        jobTitle: "React Developer",
        companyName: "Example Japan",
        url: "https://jobicy.com/jobs/j-1",
        jobGeo: "Japan",
        jobType: "Full-time",
        jobDescription: "<p>Build React applications</p>",
        pubDate: "2026-09-07T08:00:00Z"
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const jobs = await new PublicJsonJobSource("jobicy", "https://jobicy.com/api/v2/remote-jobs").fetchJobs();

    expect(jobs[0]).toMatchObject({
      source: "jobicy:json",
      sourceJobId: "j-1",
      title: "React Developer",
      companyName: "Example Japan",
      country: "Japan",
      description: "Build React applications"
    });
  });

  it("normalizes Arbeitnow jobs and converts unix timestamps", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{
        slug: "frontend-engineer-1",
        company_name: "Example Germany",
        title: "Frontend Engineer",
        description: "<p>React and TypeScript</p>",
        remote: true,
        url: "https://www.arbeitnow.com/jobs/frontend-engineer-1",
        tags: ["Engineering"],
        job_types: ["Full-time"],
        location: "Berlin",
        created_at: 1786357845
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const jobs = await new PublicJsonJobSource("arbeitnow", "https://www.arbeitnow.com/api/job-board-api").fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "arbeitnow:json",
      sourceJobId: "frontend-engineer-1",
      title: "Frontend Engineer",
      companyName: "Example Germany",
      country: "Germany",
      workplaceType: "remote",
      employmentType: "Full-time",
      description: "React and TypeScript"
    });
    expect(jobs[0]?.postedAt).toBeInstanceOf(Date);
  });

  it("uses the regional default country when an Arbeitnow UK posting has no location", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{
        slug: "uk-frontend-engineer-1",
        company_name: "Example UK",
        title: "Frontend Engineer",
        description: "<p>React and TypeScript</p>",
        remote: true,
        url: "https://www.arbeitnow.co.uk/jobs/uk-frontend-engineer-1",
        job_types: ["Full-time"],
        location: "",
        created_at: 1786357845
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const jobs = await new PublicJsonJobSource(
      "arbeitnow",
      "https://www.arbeitnow.co.uk/api/job-board-api",
      "United Kingdom"
    ).fetchJobs();

    expect(jobs[0]).toMatchObject({
      source: "arbeitnow:json",
      companyName: "Example UK",
      country: "United Kingdom",
      location: "Worldwide"
    });
  });

  it("fails closed on non-success responses", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect(new PublicJsonJobSource("himalayas", "https://example.invalid").fetchJobs())
      .rejects.toThrow("himalayas request failed: 429");
  });
});
