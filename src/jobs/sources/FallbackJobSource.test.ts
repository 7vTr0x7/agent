import { FallbackJobSource } from "./FallbackJobSource";
import { JobSource } from "./JobSource";
import { Job } from "../domain/Job";

function job(source: string): Job {
  return {
    source,
    sourceJobId: "1",
    url: "https://example.com/job",
    title: "Frontend Engineer",
    companyName: "Example",
    location: "Worldwide",
    country: null,
    workplaceType: "remote",
    employmentType: "full-time",
    description: "Build web applications.",
    postedAt: null,
    updatedAt: null,
    contentHash: "hash"
  };
}

describe("FallbackJobSource", () => {
  it("returns primary jobs when the primary source succeeds", async () => {
    const primary: JobSource = { name: "jobicy:json", fetchJobs: async () => [job("jobicy:json")] };
    const fallback: JobSource = { name: "jobicy:rss", fetchJobs: async () => [job("jobicy:rss")] };

    await expect(new FallbackJobSource(primary, fallback).fetchJobs()).resolves.toEqual([job("jobicy:json")]);
  });

  it("uses the fallback when the primary source fails", async () => {
    const primary: JobSource = { name: "jobicy:json", fetchJobs: async () => { throw new Error("API unavailable"); } };
    const fallback: JobSource = { name: "jobicy:rss", fetchJobs: async () => [job("jobicy:rss")] };

    await expect(new FallbackJobSource(primary, fallback).fetchJobs()).resolves.toEqual([job("jobicy:json")]);
  });

  it("reports both failures when neither source works", async () => {
    const primary: JobSource = { name: "jobicy:json", fetchJobs: async () => { throw new Error("API unavailable"); } };
    const fallback: JobSource = { name: "jobicy:rss", fetchJobs: async () => { throw new Error("RSS unavailable"); } };

    await expect(new FallbackJobSource(primary, fallback).fetchJobs()).rejects.toThrow(
      "jobicy:json primary and fallback sources failed: primary=API unavailable; fallback=RSS unavailable"
    );
  });
});
