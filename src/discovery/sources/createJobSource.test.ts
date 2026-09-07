import { createJobSource } from "./createJobSource";
import { PublicJsonJobSource } from "../../jobs/sources/PublicJsonJobSource";
import { RssJobSource } from "../../jobs/sources/RssJobSource";
import { RemoteOkJobSource } from "../../jobs/sources/RemoteOkJobSource";

describe("createJobSource", () => {
  it("creates an RSS source from feed configuration", () => {
    const source = createJobSource({
      id: "weworkremotely:programming",
      name: "weworkremotely",
      type: "rss",
      feedUrl: "https://weworkremotely.com/categories/remote-programming-jobs.rss"
    });

    expect(source).toBeInstanceOf(RssJobSource);
    expect(source.name).toBe("weworkremotely:programming");
  });

  it("creates the Remote OK API source", () => {
    const source = createJobSource({
      id: "remoteok:json",
      name: "remoteok",
      type: "api",
      feedUrl: "https://remoteok.com/api"
    });

    expect(source).toBeInstanceOf(RemoteOkJobSource);
    expect(source.name).toBe("remoteok:json");
  });

  it("registers Arbeitnow API sources, including regional feeds", () => {
    const germany = createJobSource({
      id: "arbeitnow:json",
      name: "arbeitnow",
      type: "api",
      feedUrl: "https://www.arbeitnow.com/api/job-board-api"
    });
    const uk = createJobSource({
      id: "arbeitnow:uk:json",
      name: "arbeitnow",
      type: "api",
      feedUrl: "https://www.arbeitnow.co.uk/api/job-board-api"
    });

    expect(germany).toBeInstanceOf(PublicJsonJobSource);
    expect(uk).toBeInstanceOf(PublicJsonJobSource);
  });

  it("rejects an unsupported API adapter", () => {
    expect(() =>
      createJobSource({ id: "unknown", name: "unknown", type: "api" })
    ).toThrow("Unsupported API job source: unknown");
  });
});
