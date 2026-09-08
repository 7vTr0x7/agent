import { TechmapJobSource } from "./TechmapJobSource";

describe("TechmapJobSource", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("supports portal-filtered normalized results", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ result: [{ id: 1, title: "Frontend Engineer", url: "https://jobs.example/frontend", company: "Example", location: "Bengaluru, India", description: "React TypeScript", workPlace: "hybrid", dateCreated: "2026-09-01T00:00:00Z" }] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const source = new TechmapJobSource({ apiUrl: "https://api.example/jobs", apiKey: "key", portals: ["naukri", "linkedin"], countryCode: "in", city: "Bengaluru", title: "Frontend", skills: "React,TypeScript" });
    const jobs = await source.fetchJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.source).toBe("techmap:naukri");
    expect(jobs[0]?.title).toBe("Frontend Engineer");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("supports global corpus mode when no portal list is supplied", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ result: [{ id: "g1", title: "React Developer", url: "https://jobs.example/react", company: { name: "Example" }, location: { city: "Bengaluru", country: "India" }, fullDescription: "React" }] }), { status: 200 })) as typeof fetch;
    const source = new TechmapJobSource({ apiUrl: "https://api.example/jobs", apiKey: "key", countryCode: "in" });
    const jobs = await source.fetchJobs();
    expect(jobs[0]?.source).toBe("techmap:global");
    expect(new URL((global.fetch as jest.Mock).mock.calls[0][0]).searchParams.has("portal")).toBe(false);
  });
});
