export type WorkplaceType = "onsite" | "remote" | "hybrid" | null;

export interface Job {
  source: string;
  sourceJobId: string;
  url: string;
  title: string;
  companyName: string;
  /** Canonical employer website domain supplied by the discovery source/configuration. */
  companyDomain?: string | null;
  location: string | null;
  country: string | null;
  workplaceType: WorkplaceType;
  employmentType: string | null;
  description: string;
  postedAt: Date | null;
  updatedAt: Date | null;
  contentHash: string;
}
