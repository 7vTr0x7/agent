import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";
import { RssJobSource } from "./RssJobSource";

export interface FreePublicJobFeed { readonly id: string; readonly url: string; readonly defaultCompanyName?: string; }

/** Free-first federation of public RSS/Atom job feeds. Protected/private endpoints are never used. */
export const FREE_PUBLIC_JOB_FEEDS: readonly FreePublicJobFeed[] = [
  { id: "weworkremotely:all", url: "https://weworkremotely.com/remote-jobs.rss", defaultCompanyName: "We Work Remotely" },
  { id: "weworkremotely:frontend", url: "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss", defaultCompanyName: "We Work Remotely" },
  { id: "python:jobs", url: "https://www.python.org/jobs/feed/rss/", defaultCompanyName: "Python.org Jobs" },
  { id: "larajobs:all", url: "https://larajobs.com/feed", defaultCompanyName: "LaraJobs" },
  { id: "fossjobs:all", url: "https://www.fossjobs.net/rss/all/", defaultCompanyName: "FOSS Jobs" },
  { id: "jobspresso:all", url: "https://jobspresso.co/feed/?post_type=job_listing", defaultCompanyName: "Jobspresso" },
  { id: "hasjob:all", url: "https://hasjob.co/feed", defaultCompanyName: "HasJob" },
  { id: "golangprojects:all", url: "https://www.golangprojects.com/rss.xml", defaultCompanyName: "Golang Projects" },
  { id: "golangremote:all", url: "https://golangjob.xyz/remote/jobs", defaultCompanyName: "Golang Remote Jobs" },
  { id: "vuejobs:all", url: "https://app.vuejobs.com/feed/posts", defaultCompanyName: "VueJobs" },
  { id: "landingjobs:remote", url: "https://landing.jobs/feed?remote=true", defaultCompanyName: "Landing.jobs" },
  { id: "iloveremote:remote", url: "https://iloveremote.io/rss/jobs/city/remote.rss", defaultCompanyName: "I Love Remote" },
  { id: "freelancer:all", url: "https://www.freelancer.com/rss.xml", defaultCompanyName: "Freelancer" },
  { id: "freelancermap:international", url: "https://www.freelancermap.com/feeds/projects/int-international.xml", defaultCompanyName: "freelancermap" },
  { id: "freshremote:all", url: "https://freshremote.work/feed/", defaultCompanyName: "FreshRemote.work" },
  { id: "functionaljobs:all", url: "https://functionaljobs.com/jobs/?format=rss", defaultCompanyName: "Functional Jobs" },
  { id: "guru:all", url: "https://www.guru.com/rss/jobs/", defaultCompanyName: "Guru" },
  { id: "jobhuntai:all", url: "https://jobhunt.ai/rss.xml", defaultCompanyName: "Jobhunt.ai" },
  { id: "krop:all", url: "http://www.krop.com/services/feeds/rss/latest/", defaultCompanyName: "Krop" },
  { id: "mashable:all", url: "http://jobs.mashable.com/jobs/search/results?format=rss", defaultCompanyName: "Mashable Jobs" },
  { id: "mozilla:careers", url: "https://www.mozilla.org/en-US/careers/feed/", defaultCompanyName: "Mozilla" },
  { id: "nodesk:remote", url: "https://nodesk.co/remote-jobs/index.xml", defaultCompanyName: "NODESK" },
  { id: "nten:jobs", url: "https://www.nten.org/feed/?post_type=job", defaultCompanyName: "NTEN" },
  { id: "pangian:jobs", url: "https://pangian.com/feed/?post_type=job_listing", defaultCompanyName: "Pangian" },
  { id: "privacyfirstjobs:remote", url: "https://privacyfirstjobs.com/jobs/feed", defaultCompanyName: "Privacy-First Jobs" },
  { id: "codeforamerica:jobs", url: "https://jobs.codeforamerica.org/job-postings.rss", defaultCompanyName: "Code for America Jobs" },
  { id: "smashingmagazine:jobs", url: "https://www.smashingmagazine.com/jobs/feed/", defaultCompanyName: "Smashing Jobs" },
  { id: "stackoverflow:remote", url: "https://stackoverflow.com/jobs/feed?r=True", defaultCompanyName: "Stack Overflow Jobs" },
  { id: "virtualvocations:jobs", url: "https://www.virtualvocations.com/jobs/rss", defaultCompanyName: "Virtual Vocations" },
  { id: "wordpress:jobs", url: "https://jobs.wordpress.net/feed/", defaultCompanyName: "WordPress Jobs" },
  { id: "wphired:jobs", url: "http://www.wphired.com/jobs/feed/", defaultCompanyName: "WP Hired" },
  { id: "dribbble:jobs", url: "https://dribbble.com/jobs.rss?anywhere=true&location=Anywhere", defaultCompanyName: "Dribbble Jobs" },
  { id: "django:gigs", url: "https://djangogigs.com/feeds/gigs/", defaultCompanyName: "Django Jobs" },
  { id: "rorjobs:all", url: "https://www.rorjobs.com/jobs.rss", defaultCompanyName: "RoR Jobs" },
  { id: "angularjobs:all", url: "https://angularjobs.com/wpjobboard/xml/rss/", defaultCompanyName: "Angular Jobs" },
  { id: "emberjobs:all", url: "https://jobs.emberjs.com/jobs.rss", defaultCompanyName: "Ember Jobs" },
  { id: "drupal:jobs", url: "https://jobs.drupal.org/all-jobs/feed", defaultCompanyName: "Drupal Jobs" },
  { id: "remotepython:all", url: "https://www.remotepython.com/latest/jobs/feed/", defaultCompanyName: "RemotePython" },
  { id: "cryptojobslist:all", url: "https://cryptojobslist.com/jobs.rss", defaultCompanyName: "CryptoJobsList" },
  { id: "cryptocurrencyjobs:all", url: "https://cryptocurrencyjobs.co/index.xml", defaultCompanyName: "Cryptocurrency Jobs" },
  { id: "codepen:jobs", url: "https://codepen.io/jobs/feed", defaultCompanyName: "CodePen Jobs" },
  { id: "wpjobs:all", url: "https://jobs.wordpress.net/feed/", defaultCompanyName: "WordPress Jobs" },
  { id: "remotejobr:all", url: "https://remotejobr.com/feed?category=1&format=rss", defaultCompanyName: "RemoteJobr" },
  { id: "berlinstartupjobs:all", url: "http://berlinstartupjobs.com/feed/", defaultCompanyName: "Berlin Startup Jobs" },
  { id: "42jobs:react", url: "https://www.42jobs.io/react/jobs.rss", defaultCompanyName: "42jobs" },
  { id: "42jobs:android", url: "https://www.42jobs.io/android/jobs.rss", defaultCompanyName: "42jobs" }
];

export class FreePublicJobFeedBundleSource implements JobSource {
  readonly name = "free-public-job-feeds";
  constructor(private readonly feeds: readonly FreePublicJobFeed[] = FREE_PUBLIC_JOB_FEEDS) {}
  async fetchJobs(): Promise<Job[]> {
    const results = await Promise.allSettled(this.feeds.map((feed) => new RssJobSource({ name: feed.id, feedUrl: feed.url, defaultCompanyName: feed.defaultCompanyName }).fetchJobs()));
    return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }
}
