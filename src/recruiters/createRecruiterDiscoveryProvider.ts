import { PublicRecruiterSearchProvider } from "./PublicRecruiterSearchProvider";
import { RecruiterDiscoveryProvider } from "./RecruiterDiscovery";

export type RecruiterDiscoveryProviderId = "public-web";

export interface RecruiterDiscoveryProviderConfig {
  provider: RecruiterDiscoveryProviderId;
  /** @deprecated Kept only for backwards-compatible callers; public-web never uses it. */
  hunterApiKey?: string;
  /** @deprecated Kept only for backwards-compatible callers; public-web never uses them. */
  snovClientId?: string;
  snovClientSecret?: string;
}

/**
 * Free-first recruiter discovery.
 *
 * Uses public search-engine result pages through a text-rendering proxy so
 * containerized environments are not dependent on direct search-engine HTML
 * access. It never logs into LinkedIn or scrapes authenticated/private data.
 */
export function createRecruiterDiscoveryProvider(_config: RecruiterDiscoveryProviderConfig): RecruiterDiscoveryProvider {
  return new PublicRecruiterSearchProvider();
}
