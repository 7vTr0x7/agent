import { FallbackRecruiterDiscoveryProvider } from "./FallbackRecruiterDiscoveryProvider";
import { HunterRecruiterDiscoveryProvider } from "./HunterRecruiterDiscoveryProvider";
import { JobPostingRecruiterDiscoveryProvider } from "./JobPostingRecruiterDiscoveryProvider";
import { RecruiterDiscoveryProvider } from "./RecruiterDiscovery";
import { SnovRecruiterDiscoveryProvider } from "./SnovRecruiterDiscoveryProvider";

export type RecruiterDiscoveryProviderId = "hunter" | "snov" | "job-posting";

export interface RecruiterDiscoveryProviderConfig {
  provider: RecruiterDiscoveryProviderId;
  hunterApiKey?: string | null;
  snovClientId?: string | null;
  snovClientSecret?: string | null;
}

export function createRecruiterDiscoveryProvider(config: RecruiterDiscoveryProviderConfig): RecruiterDiscoveryProvider {
  const jobPosting = new JobPostingRecruiterDiscoveryProvider();

  if (config.provider === "job-posting") return jobPosting;

  if (config.provider === "snov") {
    if (!config.snovClientId || !config.snovClientSecret) {
      throw new Error("Snov recruiter discovery requires SNOV_CLIENT_ID and SNOV_CLIENT_SECRET");
    }
    const snov = new SnovRecruiterDiscoveryProvider({
      clientId: config.snovClientId,
      clientSecret: config.snovClientSecret
    });
    return new FallbackRecruiterDiscoveryProvider(snov, jobPosting, snov);
  }

  if (!config.hunterApiKey) {
    throw new Error("Hunter recruiter discovery requires HUNTER_API_KEY");
  }
  const hunter = new HunterRecruiterDiscoveryProvider({ apiKey: config.hunterApiKey });
  return new FallbackRecruiterDiscoveryProvider(hunter, jobPosting, hunter);
}
