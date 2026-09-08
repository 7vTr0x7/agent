import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";
import { RssJobSource } from "./RssJobSource";

export interface FreePublicJobFeed {
  readonly id: string;
  readonly url: string;
  readonly defaultCompanyName?: string;
}

/**
 * Free-first federation of public RSS/Atom job feeds.
 *
 * This intentionally uses only public feeds; it does not log in, bypass
 * CAPTCHAs, rotate proxies, or call private endpoints. Individual feed
 * failures are isolated so one broken board cannot stop discovery.
 */
export const FREE_PUBLIC_JOB_FEEDS: readonly FreePublicJobFeed[] = [
  { id: "weworkremotely:all", url: "https://weworkremotely.com/remote-jobs.rss", defaultCompanyName: "We Work Remotely" },
  { id: "weworkremotely:frontend", url: "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss", defaultCompanyName: "We Work Remotely" },
  { id: "python:jobs", url: "https://www.python.org/jobs/feed/rss/", defaultCompanyName: "Python.org Jobs" },
  { id: "larajobs:all", url: "https://larajobs.com/feed", defaultCompanyName: "LaraJobs" },
  { id: "fossjobs:all", url: "https://www.fossjobs.net/rss/all/", defaultCompanyName: "FOSS Jobs" },
  { id: "jobspresso:all", url: "https://jobspresso.co/feed/?post_type=job_listing", defaultCompanyName: "Jobspresso" },
  { id: "hasjob:all", url: "https://hasjob.co/feed", defaultCompanyName: "HasJob" },
  { id: "golangprojects:all", url: "https://www.golangprojects.com/rss.xml", defaultCompanyName: "Golang Projects" },
  { id: "vuejobs:all", url: "https://app.vuejobs.com/feed/posts", defaultCompanyName: "VueJobs" },
  { id: "landingjobs:remote", url: "https://landing.jobs/feed?remote=true", defaultCompanyName: "Landing.jobs" },
  { id: "iloveremote:remote", url: "https://iloveremote.io/rss/jobs/city/remote.rss", defaultCompanyName: "I Love Remote" },
  { id: "freelancer:all", url: "https://www.freelancer.com/rss.xml", defaultCompanyName: "Freelancer" }
];

export class FreePublicJobFeedBundleSource implements JobSource {
  readonly name = "free-public-job-feeds";

  constructor(private readonly feeds: readonly FreePublicJobFeed[] = FREE_PUBLIC_JOB_FEEDS) {}

  async fetchJobs(): Promise<Job[]> {
    const results = await Promise.allSettled(
      this.feeds.map((feed) => new RssJobSource({ name: feed.id, feedUrl: feed.url, defaultCompanyName: feed.defaultCompanyName }).fetchJobs())
    );
    return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }
}
