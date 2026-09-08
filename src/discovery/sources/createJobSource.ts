import { SourceConfig } from "./SourceConfig";
import { JobSource } from "../../jobs/sources/JobSource";
import { LeverJobSource } from "../../jobs/sources/LeverJobSource";
import { GreenhouseJobSource } from "../../jobs/sources/GreenhouseJobSource";
import { AshbyJobSource } from "../../jobs/sources/AshbyJobSource";
import { RssJobSource } from "../../jobs/sources/RssJobSource";
import { RemoteOkJobSource } from "../../jobs/sources/RemoteOkJobSource";
import { PublicJsonJobSource } from "../../jobs/sources/PublicJsonJobSource";
import { FallbackJobSource } from "../../jobs/sources/FallbackJobSource";
import { StructuredDataJobSource } from "../../jobs/sources/StructuredDataJobSource";

export function createJobSource(config: SourceConfig): JobSource {
  switch (config.type) {
    case "ats": return createAtsSource(config);
    case "rss": return createRssSource(config);
    case "api": return createApiSource(config);
    case "web":
    case "structured-data": return createStructuredDataSource(config);
    default: throw new Error(`No job-source adapter is registered for source type: ${config.type}`);
  }
}

function createAtsSource(config: SourceConfig): JobSource {
  const adapter = config.name.toLowerCase();
  if (adapter === "lever") {
    if (!config.boardToken) throw new Error("Lever source requires boardToken");
    return new LeverJobSource(config.boardToken, undefined, config.companyDomain);
  }
  if (adapter === "greenhouse") {
    if (!config.boardToken) throw new Error("Greenhouse source requires boardToken");
    return new GreenhouseJobSource(config.boardToken, undefined, config.companyDomain);
  }
  if (adapter === "ashby") {
    if (!config.boardName) throw new Error("Ashby source requires boardName");
    return new AshbyJobSource(config.boardName, undefined, config.companyDomain);
  }
  throw new Error(`Unsupported ATS adapter: ${config.name}`);
}

function createRssSource(config: SourceConfig): JobSource {
  if (!config.feedUrl) throw new Error(`RSS source requires feedUrl: ${config.name}`);
  return new RssJobSource({ name: config.id, feedUrl: config.feedUrl, defaultCompanyName: config.name });
}

function createApiSource(config: SourceConfig): JobSource {
  const adapter = config.name.toLowerCase();
  if (adapter === "remoteok") return new RemoteOkJobSource(config.feedUrl);
  if (adapter === "himalayas") {
    if (!config.feedUrl) throw new Error("himalayas source requires feedUrl");
    return new PublicJsonJobSource(adapter, config.feedUrl);
  }
  if (adapter === "arbeitnow") {
    if (!config.feedUrl) throw new Error("arbeitnow source requires feedUrl");
    const isUkFeed = config.feedUrl.toLowerCase().includes("arbeitnow.co.uk");
    return new PublicJsonJobSource(adapter, config.feedUrl, isUkFeed ? "United Kingdom" : null);
  }
  if (adapter === "jobicy") {
    if (!config.feedUrl) throw new Error("jobicy source requires feedUrl");
    const api = new PublicJsonJobSource(adapter, config.feedUrl);
    const rss = new RssJobSource({
      name: config.id,
      feedUrl: "https://jobicy.com/jobs/feed",
      defaultCompanyName: "Jobicy"
    });
    return new FallbackJobSource(api, rss);
  }
  throw new Error(`Unsupported API job source: ${config.name}`);
}

function createStructuredDataSource(config: SourceConfig): JobSource {
  if (!config.url) throw new Error(`${config.type} source requires url: ${config.name}`);
  return new StructuredDataJobSource({
    id: config.id,
    url: config.url,
    defaultCompanyName: config.name,
    companyDomain: config.companyDomain
  });
}
