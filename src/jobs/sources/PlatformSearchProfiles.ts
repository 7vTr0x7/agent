export interface PlatformSearchProfile {
  readonly platform: string;
  readonly searchUrls: readonly string[];
}

/**
 * Verified first-party collection/search pages for platforms whose public search
 * pages are more reliable than search-engine result pages. These are fallbacks;
 * the generic search-engine federation remains enabled for every platform.
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
  }
};

export function getPlatformSearchProfile(platformName: string): PlatformSearchProfile | undefined {
  return SEARCH_PROFILES[platformName];
}

export function getPlatformSearchUrls(platformName: string): readonly string[] {
  return getPlatformSearchProfile(platformName)?.searchUrls ?? [];
}
