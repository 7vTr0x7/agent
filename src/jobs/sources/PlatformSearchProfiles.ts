import { sourceList } from "../../recruiters/PublicSearchProviderRegistry";

export interface PlatformSearchProfile {
  readonly platform: string;
  readonly searchUrls: readonly string[];
}

/**
 * Verified first-party collection/search pages for platforms whose public search
 * pages are more reliable than search-engine result pages. These are combined
 * with the complete public-search provider fan-out so one provider never hides
 * results from the others.
 */
const SEARCH_PROFILES: Readonly<Record<string, PlatformSearchProfile>> = {
  Cutshort: {
    platform: "Cutshort",
    searchUrls: [
      "https://cutshort.io/jobs/reactjs-jobs-in-bangalore-bengaluru",
      "https://cutshort.io/jobs/frontend-developer-jobs-in-bangalore-bengaluru",
      "https://cutshort.io/jobs/fullstack-developer-jobs-in-bangalore-bengaluru",
      "https://cutshort.io/jobs/reactjs-jobs"
    ]
  },
  Hirist: {
    platform: "Hirist",
    searchUrls: [
      "https://www.hirist.tech/k/reactjs-jobs?pref=rl",
      "https://www.hirist.tech/k/frontend-developer-jobs?pref=rl",
      "https://www.hirist.tech/k/full-stack-developer-jobs?pref=rl",
      "https://www.hirist.tech/k/javascript-jobs?pref=rl"
    ]
  },
  Foundit: {
    platform: "Foundit",
    searchUrls: [
      "https://www.foundit.in/search/reactjs-jobs-in-bengaluru-bangalore",
      "https://www.foundit.in/search/frontend-developer-jobs-in-bengaluru-bangalore",
      "https://www.foundit.in/search/full-stack-developer-jobs-in-bengaluru-bangalore",
      "https://www.foundit.in/search/react-js-jobs-in-bengaluru-bangalore"
    ]
  },
  "Remote OK": {
    platform: "Remote OK",
    searchUrls: ["https://remoteok.com/remote-jobs.rss"]
  },
  "We Work Remotely": {
    platform: "We Work Remotely",
    searchUrls: [
      "https://weworkremotely.com/remote-jobs.rss",
      "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss"
    ]
  },
  Himalayas: {
    platform: "Himalayas",
    searchUrls: ["https://himalayas.app/jobs/rss"]
  },
  Jobicy: {
    platform: "Jobicy",
    searchUrls: ["https://jobicy.com/jobs/feed"]
  }
};

function publicSearchQuery(platformName: string): string {
  return `"${platformName}" (React OR "Next.js" OR Frontend OR "Frontend Developer" OR "Full Stack Developer" OR TypeScript) (Bengaluru OR Bangalore OR India OR Remote)`;
}

/**
 * Returns first-party sources plus one URL for every configured public search
 * provider. Platform discovery therefore performs provider fan-out even when
 * the generic search helper has an early-success result for one provider.
 */
export function getPlatformSearchProfile(platformName: string): PlatformSearchProfile | undefined {
  return SEARCH_PROFILES[platformName];
}

export function getPlatformSearchUrls(platformName: string): readonly string[] {
  const firstParty = [...(getPlatformSearchProfile(platformName)?.searchUrls ?? [])];
  const providerUrls = sourceList(publicSearchQuery(platformName)).map((source) => source.url);
  return [...new Set([...firstParty, ...providerUrls])];
}
