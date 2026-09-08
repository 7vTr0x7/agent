import { JobPostingRecruiterDiscoveryProvider } from "./JobPostingRecruiterDiscoveryProvider";
import { RecruiterDiscoveryProvider } from "./RecruiterDiscovery";

export type RecruiterDiscoveryProviderId = "public-web";

export interface RecruiterDiscoveryProviderConfig {
  provider: RecruiterDiscoveryProviderId;
}

/**
 * Free-first recruiter discovery.
 *
 * No Hunter/Snov/Apollo credentials are required. The provider searches the
 * job posting, first-party company pages, career/contact pages, sitemaps,
 * public search results and public LinkedIn profile evidence. It never logs
 * into LinkedIn or scrapes authenticated/private LinkedIn data.
 */
export function createRecruiterDiscoveryProvider(_config: RecruiterDiscoveryProviderConfig): RecruiterDiscoveryProvider {
  return new JobPostingRecruiterDiscoveryProvider();
}
