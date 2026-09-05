import { createJobSource } from "./createJobSource";

describe("createJobSource", () => {
  it("creates an RSS source from feed configuration", () => {
    const source = createJobSource({
      id: "weworkremotely:programming",
      name: "weworkremotely",
      type: "rss",
      feedUrl: "https://weworkremotely.com/categories/remote-programming-jobs.rss"
    });

    expect(source.name).toBe("weworkremotely:programming");
  });

  it("creates the Remote OK API source", () => {
    const source = createJobSource({
      id: "remoteok:json",
      name: "remoteok",
      type: "api"
    });

    expect(source.name).toBe("remoteok:json");
  });

  it("rejects an unsupported API adapter", () => {
    expect(() =>
      createJobSource({ id: "unknown", name: "unknown", type: "api" })
    ).toThrow("Unsupported API job source: unknown");
  });
});
