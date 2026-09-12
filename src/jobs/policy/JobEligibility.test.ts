import {
  evaluateJobEligibility,
  JobSearchPolicy
} from "./JobEligibility";
import { Job } from "../domain/Job";

const policy: JobSearchPolicy = {
  priorityLocations: ["Bangalore", "Bengaluru"],
  targetCountry: "India",
  allowRemote: true,
  excludedCompanies: ["Octopus Technologies", "Sketch Brahma Technologies"],
  maxAgeDays: 7
};

function job(overrides: Partial<Job>): Job {
  return {
    source: "test",
    sourceJobId: "1",
    url: "https://example.com/job",
    title: "Frontend Engineer",
    companyName: "Example Company",
    location: "Bangalore, India",
    country: "India",
    workplaceType: "onsite",
    employmentType: "Full-time",
    description: "React TypeScript",
    postedAt: null,
    updatedAt: null,
    contentHash: "test",
    ...overrides
  };
}

describe("evaluateJobEligibility", () => {
  test("Bangalore gets highest priority", () => {
    expect(evaluateJobEligibility(job({ location: "Bengaluru, Karnataka, India" }), policy)).toMatchObject({ decision: "ELIGIBLE", priority: 1 });
  });

  test("other India location is eligible with lower priority", () => {
    expect(evaluateJobEligibility(job({ location: "Pune, Maharashtra, India" }), policy)).toMatchObject({ decision: "ELIGIBLE", priority: 2 });
  });

  test("remote is eligible", () => {
    expect(evaluateJobEligibility(job({ location: "Remote", country: null, workplaceType: "remote" }), policy)).toMatchObject({ decision: "ELIGIBLE", priority: 3 });
  });

  test("excluded companies are rejected", () => {
    expect(evaluateJobEligibility(job({ companyName: "Octopus Technologies" }), policy)).toMatchObject({ decision: "REJECT", priority: null });
    expect(evaluateJobEligibility(job({ companyName: "Sketch Brahma Technologies" }), policy)).toMatchObject({ decision: "REJECT", priority: null });
  });

  test("outside-India onsite role is rejected", () => {
    expect(evaluateJobEligibility(job({ location: "London, United Kingdom", country: "United Kingdom" }), policy)).toMatchObject({ decision: "REJECT", priority: null });
  });

  test("stale posted job is rejected", () => {
    const postedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    expect(evaluateJobEligibility(job({ postedAt }), policy)).toMatchObject({ decision: "REJECT", priority: null });
  });

  test("future posted job is rejected", () => {
    const postedAt = new Date(Date.now() + 60 * 60 * 1000);
    expect(evaluateJobEligibility(job({ postedAt }), policy)).toMatchObject({ decision: "REJECT", priority: null });
  });

  test("unknown posted date remains eligible rather than being treated as stale", () => {
    expect(evaluateJobEligibility(job({ postedAt: null }), policy)).toMatchObject({ decision: "ELIGIBLE", priority: 1 });
  });

  test("remote is rejected when remote work is disabled", () => {
    expect(evaluateJobEligibility(job({ location: "Remote", country: null, workplaceType: "remote" }), { ...policy, allowRemote: false })).toMatchObject({ decision: "REJECT", priority: null });
  });

  test("high-risk payment request is rejected before application ranking", () => {
    expect(evaluateJobEligibility(job({ title: "Remote Frontend Engineer", description: "Pay a registration fee before the interview." }), policy)).toMatchObject({ decision: "REJECT", priority: null });
  });

  test("medium-risk messaging language remains eligible with a warning", () => {
    expect(evaluateJobEligibility(job({ description: "Contact only via Telegram to proceed." }), policy)).toMatchObject({ decision: "ELIGIBLE", priority: 1, reason: expect.stringContaining("medium-risk warning") });
  });
});
