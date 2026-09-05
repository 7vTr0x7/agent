import { JobOpportunity } from "../../jobs/domain/JobOpportunity";
import { JobSearchPolicy } from "../../jobs/policy/JobEligibility";
import { DiscoveryMatchDispatcher } from "./DiscoveryMatchDispatcher";

const policy: JobSearchPolicy = {
  priorityLocations: ["Bangalore", "Bengaluru"],
  targetCountry: "India",
  allowRemote: true,
  excludedCompanies: ["Octopus Technologies", "Sketch Brahma Technologies"],
  maxAgeDays: 0
};

function opportunity(overrides: Partial<JobOpportunity> = {}): JobOpportunity {
  return {
    id: "opportunity-1",
    canonicalId: "canonical-1",
    canonicalUrl: "https://example.com/jobs/frontend",
    title: "Frontend Engineer",
    companyName: "Example",
    location: "Bangalore, India",
    country: "India",
    workplaceType: "onsite",
    employmentType: "Full-time",
    description: "React and TypeScript",
    postedAt: null,
    updatedAt: null,
    lastSeenAt: new Date(),
    closedAt: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

describe("DiscoveryMatchDispatcher", () => {
  test("enqueues newly discovered eligible opportunities with location priority", async () => {
    const enqueued: Array<{ id: string; profileId: string; priority: number }> = [];
    const opportunities = {
      findById: async () => opportunity()
    };
    const matchTasks = {
      enqueue: async (id: string, profileId: string, priority: number) => {
        enqueued.push({ id, profileId, priority });
        return "task-1";
      }
    };

    const dispatcher = new DiscoveryMatchDispatcher(
      opportunities as never,
      matchTasks as never,
      policy,
      "default-profile"
    );

    const result = await dispatcher.dispatch(["opportunity-1"]);

    expect(result).toEqual({ enqueued: 1, rejected: 0, missing: 0 });
    expect(enqueued).toEqual([
      { id: "opportunity-1", profileId: "default-profile", priority: 30 }
    ]);
  });

  test("does not enqueue explicitly excluded companies", async () => {
    const enqueue = jest.fn();
    const opportunities = {
      findById: async () =>
        opportunity({ companyName: "Octopus Technologies" })
    };
    const matchTasks = { enqueue };

    const dispatcher = new DiscoveryMatchDispatcher(
      opportunities as never,
      matchTasks as never,
      policy,
      "default-profile"
    );

    const result = await dispatcher.dispatch(["opportunity-1"]);

    expect(result).toEqual({ enqueued: 0, rejected: 1, missing: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("keeps outside-India opportunities eligible for candidate evaluation", async () => {
    const enqueue = jest.fn().mockResolvedValue("task-1");
    const opportunities = {
      findById: async () =>
        opportunity({ location: "London, United Kingdom", country: "United Kingdom" })
    };
    const matchTasks = { enqueue };

    const dispatcher = new DiscoveryMatchDispatcher(
      opportunities as never,
      matchTasks as never,
      policy,
      "default-profile"
    );

    const result = await dispatcher.dispatch(["opportunity-1"]);

    expect(result).toEqual({ enqueued: 1, rejected: 0, missing: 0 });
    expect(enqueue).toHaveBeenCalledWith(
      "opportunity-1",
      "default-profile",
      10
    );
  });
});
