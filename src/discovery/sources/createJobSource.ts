import { SourceConfig } from "./SourceConfig";
import { JobSource } from "../../jobs/sources/JobSource";
import { LeverJobSource } from "../../jobs/sources/LeverJobSource";
import { GreenhouseJobSource } from "../../jobs/sources/GreenhouseJobSource";
import { AshbyJobSource } from "../../jobs/sources/AshbyJobSource";

export function createJobSource(config: SourceConfig): JobSource {
  switch (config.type) {
    case "ats":
      return createAtsSource(config);
    default:
      throw new Error(`No job-source adapter is registered for source type: ${config.type}`);
  }
}

function createAtsSource(config: SourceConfig): JobSource {
  const adapter = config.name.toLowerCase();

  if (adapter === "lever") {
    if (!config.boardToken) throw new Error("Lever source requires boardToken");
    return new LeverJobSource(config.boardToken);
  }

  if (adapter === "greenhouse") {
    if (!config.boardToken) throw new Error("Greenhouse source requires boardToken");
    return new GreenhouseJobSource(config.boardToken);
  }

  if (adapter === "ashby") {
    if (!config.boardName) throw new Error("Ashby source requires boardName");
    return new AshbyJobSource(config.boardName);
  }

  throw new Error(`Unsupported ATS adapter: ${config.name}`);
}
