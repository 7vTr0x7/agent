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
 * job posting plus first-party company pages, career/contact pages, sitemaps,
 * mailto links and common obfuscated email forms. Keeping discovery local to
 * public sources avoids paid databases and prevents the application from
 * depending on an external lead-enrichment vendor.
 */
export function createRecruiterDiscoveryProvider(_config: RecruiterDiscoveryProviderConfig): RecruiterDiscoveryProvider {
  return new JobPostingRecruiterDiscoveryProvider();
}
