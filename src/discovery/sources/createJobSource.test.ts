import { createJobSource } from "./createJobSource";
import { PublicJsonJobSource } from "../../jobs/sources/PublicJsonJobSource";
import { RssJobSource } from "../../jobs/sources/RssJobSource";
import { RemoteOkJobSource } from "../../jobs/sources/RemoteOkJobSource";
import { FallbackJobSource } from "../../jobs/sources/FallbackJobSource";
import { StructuredDataJobSource } from "../../jobs/sources/StructuredDataJobSource";

describe("createJobSource", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it("creates a public structured-data source without making a network call", () => {
    const source = createJobSource({
      id: "example:web",
      name: "example",
      type: "web",
      url: "https://example.com/jobs"
    });

    expect(source).toBeInstanceOf(StructuredDataJobSource);
    expect(source.name).toBe("example:web");
  });

  it("constructs every default API and RSS source without making network calls", () => {
    const sources = [
      { id: "remoteok:json", type: "api" as const, name: "remoteok", feedUrl: "https://remoteok.com/api" },
      { id: "himalayas:json", type: "api" as const, name: "himalayas", feedUrl: "https://himalayas.app/jobs/api?limit=20" },
      { id: "jobicy:json", type: "api" as const, name: "jobicy", feedUrl: "https://jobicy.com/api/v2/remote-jobs?count=200" },
      { id: "arbeitnow:json", type: "api" as const, name: "arbeitnow", feedUrl: "https://www.arbeitnow.com/api/job-board-api" },
      { id: "arbeitnow:uk:json", type: "api" as const, name: "arbeitnow", feedUrl: "https://www.arbeitnow.co.uk/api/job-board-api" },
      { id: "weworkremotely:rss", type: "rss" as const, name: "weworkremotely", feedUrl: "https://weworkremotely.com/remote-jobs.rss" },
      { id: "remotefirstjobs:react:rss", type: "rss" as const, name: "remotefirstjobs-react", feedUrl: "https://remotefirstjobs.com/rss/react" },
      { id: "remotefirstjobs:software:rss", type: "rss" as const, name: "remotefirstjobs-software", feedUrl: "https://remotefirstjobs.com/rss/software-development" },
      { id: "remoteyeah:engineering:rss", type: "rss" as const, name: "remoteyeah-engineering", feedUrl: "https://remoteyeah.com/rss.xml" },
      { id: "workanywhere:frontend:rss", type: "rss" as const, name: "workanywhere-frontend", feedUrl: "https://www.workanywhere.pro/rss/frontend" },
      { id: "workanywhere:fullstack:rss", type: "rss" as const, name: "workanywhere-fullstack", feedUrl: "https://www.workanywhere.pro/rss/fullstack" },
      { id: "hireweb3:rss", type: "rss" as const, name: "hireweb3", feedUrl: "https://hireweb3.io/job/rss" }
    ];

    const created = sources.map(createJobSource);

    expect(created).toHaveLength(sources.length);
    expect(created.filter((source) => source instanceof RssJobSource)).toHaveLength(7);
    expect(created.filter((source) => source instanceof PublicJsonJobSource)).toHaveLength(3);
    expect(created.filter((source) => source instanceof RemoteOkJobSource)).toHaveLength(1);
    expect(created.filter((source) => source instanceof FallbackJobSource)).toHaveLength(1);
  });

  it("rejects an unsupported API adapter", () => {
    expect(() =>
      createJobSource({ id: "unknown", name: "unknown", type: "api" })
    ).toThrow("Unsupported API job source: unknown");
  });
});
