import { SourceRegistry } from "./SourceRegistry";
import { JobSource } from "../../jobs/sources/JobSource";
import { SourceDescriptor } from "../policy/SourcePolicy";

const source: JobSource = {
  name: "test-source",
  fetchJobs: async () => []
};

function descriptor(
  overrides: Partial<SourceDescriptor> = {}
): SourceDescriptor {
  return {
    id: "test-source",
    name: "Test Source",
    type: "api",
    policy: {
      status: "APPROVED",
      allowedSourceTypes: ["api"]
    },
    ...overrides
  };
}

describe("SourceRegistry", () => {
  test("returns only approved sources with an allowed source type", () => {
    const registry = new SourceRegistry();

    registry.register({ descriptor: descriptor(), source });
    registry.register({
      descriptor: descriptor({
        id: "review-source",
        name: "Review Source",
        policy: {
          status: "REVIEW_REQUIRED",
          allowedSourceTypes: ["api"]
        }
      }),
      source: { ...source, name: "review-source" }
    });
    registry.register({
      descriptor: descriptor({
        id: "blocked-source",
        name: "Blocked Source",
        policy: {
          status: "APPROVED",
          allowedSourceTypes: ["rss"]
        }
      }),
      source: { ...source, name: "blocked-source" }
    });

    expect(registry.listRunnable().map(({ descriptor: item }) => item.id)).toEqual([
      "test-source"
    ]);
  });

  test("rejects duplicate registrations", () => {
    const registry = new SourceRegistry();
    registry.register({ descriptor: descriptor(), source });

    expect(() => registry.register({ descriptor: descriptor(), source })).toThrow(
      "Source is already registered: test-source"
    );
  });

  test("requires descriptor id to match the source name", () => {
    const registry = new SourceRegistry();

    expect(() =>
      registry.register({
        descriptor: descriptor(),
        source: { ...source, name: "different-name" }
      })
    ).toThrow("must match source name");
  });
});
