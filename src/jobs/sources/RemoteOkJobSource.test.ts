import { RemoteOkJobSource } from "./RemoteOkJobSource";

describe("RemoteOkJobSource", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("ignores non-job metadata records and normalizes valid jobs", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { legal: "Remote OK metadata" },
          {
            id: 123,
            slug: "frontend-engineer-123",
            position: "Frontend Engineer",
            company: "Example Corp",
            description: "<p>React and TypeScript</p>",
            url: "https://remoteok.com/remote-jobs/frontend-engineer-123",
            location: "Bengaluru, India",
            epoch: 1788256800,
            job_type: "full-time"
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const jobs = await new RemoteOkJobSource("https://example.com/api").fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "remoteok:json",
      sourceJobId: "123",
      title: "Frontend Engineer",
      companyName: "Example Corp",
      workplaceType: "remote",
      employmentType: "full-time",
      country: "India",
      description: "React and TypeScript"
    });
  });

  it("rejects an unexpected top-level payload", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jobs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await expect(
      new RemoteOkJobSource("https://example.com/api").fetchJobs()
    ).rejects.toMatchObject({
      code: "JOB_SOURCE_INVALID_DATA",
      statusCode: 502
    });
  });
});
