export type JobPlatformKind = "job-board" | "remote-board" | "developer-board" | "aggregator" | "ats" | "community" | "category";
export type JobPlatformCapability = "active-adapter" | "configurable-adapter" | "catalog-only";

export interface JobPlatformDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind: JobPlatformKind;
  readonly capability: JobPlatformCapability;
  readonly aliases?: readonly string[];
}

const activeAdapterNames = new Set([
  "Remote OK", "We Work Remotely", "Himalayas", "Jobicy", "Greenhouse", "Lever", "Ashby"
]);

const configurableNames = new Set([
  "Greenhouse", "Lever", "Ashby", "Workday", "SmartRecruiters", "iCIMS", "Taleo", "Jobvite", "Workable", "Recruitee", "Teamtailor", "Personio", "BambooHR", "Pinpoint", "Breezy HR", "Comeet", "JazzHR", "Rippling", "Zoho Recruit", "Manatal", "ApplicantPro", "ClearCompany", "Bullhorn", "UKG", "SAP SuccessFactors", "Oracle Recruiting", "ADP Recruiting", "Paylocity", "Cornerstone"
]);

const names = [
  "Naukri", "LinkedIn Jobs", "Indeed India", "Instahyre", "Cutshort", "Hirist", "Foundit", "TimesJobs", "Shine", "Freshersworld", "Wellfound", "Glassdoor India", "Apna", "WorkIndia", "iimjobs", "JobsForHer", "CareerBuilder India", "Talent500", "Hasjob", "Startup Jobs India", "Youth4work", "Internshala", "Unstop", "Placement India", "Careerjet India", "JobStreet India", "GrabJobs India", "Adzuna India", "Jooble India", "Jora India", "Jobrapido India", "Talent.com India", "Quikr Jobs", "OLX Jobs", "Aasaanjobs", "Job Hai", "Rozgaar India", "Fresherslive Jobs", "CareerIndia", "Sarkari Result Jobs", "Government Jobs", "CareerAge", "Employment News", "Wisdom Jobs", "Jobsora India", "Jobeka India", "Jobted India", "PlacementIndia", "CareerBuilder", "Monster India", "Remote OK", "We Work Remotely", "Himalayas", "Jobicy", "Remotive", "Remote.co", "Working Nomads", "JustRemote", "Remote Leaf", "Jobspresso", "FlexJobs", "Arc", "Turing", "Gun.io", "RemoteWoman", "RemoteHub", "Remote4Me", "Remoters", "Pangian", "SkipTheDrive", "Virtual Vocations", "Jobgether", "DailyRemote", "Remote Jobs Club", "Remotees", "Dynamite Jobs", "RemoteJobs.org", "Remote.io", "RemoteJobs.com", "Remote Rocketship", "Remote Circle", "Remote Workmate", "Remote3", "Remote Work", "Remote Work Hub", "Remote Career", "Remote Job Finder", "Remote Work Junkie", "Remote Jobs Ninja", "Remote Career Network", "Remote Job Hunting", "RemoteGurus", "Remote4Africa", "Working Remotely", "Remote Job Board", "Remote Jobs Central", "Remote Jobs Search", "Remote Jobs Today", "Remote Jobs Global", "Remote Work Jobs", "Dice", "Built In", "Authentic Jobs", "Dribbble Jobs", "Behance Jobs", "WeAreDevelopers", "JavaScript Jobs", "React Jobs", "Python Jobs", "Ruby on Rails Jobs", "PHP Jobs", "Golang Jobs", "Rust Jobs", "DevOps Jobs", "Kubernetes Jobs", "Cloud Jobs", "AI Jobs", "Machine Learning Jobs", "Blockchain Jobs", "Crypto Jobs", "Web3 Jobs", "Y Combinator Jobs", "Startup Jobs", "Landing.jobs", "No Fluff Jobs", "Hired", "PowerToFly", "Tech Ladies", "Working Not Working", "Mashable Jobs", "Coroflot", "Design Jobs", "Product Jobs", "UX Jobs", "Frontend Jobs", "Backend Jobs", "Software Engineer Jobs", "Remote Developer Jobs", "Tech Jobs", "Startup Jobs Board", "Monster", "ZipRecruiter", "CareerBuilder", "SimplyHired", "Talent.com", "Jooble", "Adzuna", "Jora", "Jobrapido", "JobisJob", "Careerjet", "Lensa", "The Muse", "Idealist", "Snagajob", "Craigslist Jobs", "JobServe", "Joblift", "Jobted", "Jobs2Careers", "Recruit.net", "SEEK", "JobStreet", "JobsDB", "JobsCentral", "MyCareersFuture", "FastJobs", "GrabJobs", "JobStreet Asia", "Talent.com Global", "Greenhouse", "Lever", "Ashby", "Workday", "SmartRecruiters", "iCIMS", "Taleo", "Jobvite", "Workable", "Recruitee", "Teamtailor", "Personio", "BambooHR", "Pinpoint", "Breezy HR", "Comeet", "JazzHR", "Rippling", "Zoho Recruit", "Manatal", "ApplicantPro", "ClearCompany", "Bullhorn", "UKG", "SAP SuccessFactors", "Oracle Recruiting", "ADP Recruiting", "Paylocity", "Cornerstone", "SmartRecruiters Jobs"
] as const;

function kindFor(name: string): JobPlatformKind {
  if (configurableNames.has(name)) return "ats";
  if (/^(React|JavaScript|Python|Ruby|PHP|Golang|Rust|DevOps|Kubernetes|Cloud|AI|Machine Learning|Blockchain|Crypto|Web3|Frontend|Backend|Software Engineer|Remote Developer|Tech|Design|Product|UX) Jobs$/i.test(name)) return "category";
  if (/Remote|Remotely|Remote OK|Himalayas|Jobicy|Pangian|Working Nomads|FlexJobs|JustRemote|DailyRemote|Virtual Vocations/i.test(name)) return "remote-board";
  if (/^Monster$|^CareerBuilder$|^Talent\.com$|^Jooble$|^Adzuna$|^Jora$|^Jobrapido$|^JobStreet$|^GrabJobs$|^Jobted$|^Careerjet$/.test(name)) return "aggregator";
  if (/^Y Combinator Jobs$|^Startup Jobs/.test(name)) return "community";
  return "job-board";
}

function definition(name: string, index: number): JobPlatformDefinition {
  const capability: JobPlatformCapability = activeAdapterNames.has(name) ? "active-adapter" : configurableNames.has(name) ? "configurable-adapter" : "catalog-only";
  return { id: `${String(index + 1).padStart(3, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, name, kind: kindFor(name), capability };
}

export const JOB_PLATFORM_REGISTRY: readonly JobPlatformDefinition[] = names.map(definition);
export const JOB_PLATFORM_COUNT = JOB_PLATFORM_REGISTRY.length;

export function findJobPlatform(value: string): JobPlatformDefinition | undefined {
  const normalized = value.trim().toLowerCase();
  return JOB_PLATFORM_REGISTRY.find((platform) => platform.name.toLowerCase() === normalized || platform.id === normalized);
}
