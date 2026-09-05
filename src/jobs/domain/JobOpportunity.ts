export type WorkplaceType = "onsite" | "remote" | "hybrid" | null;

export type JobOpportunityStatus = "ACTIVE" | "STALE" | "CLOSED";

export interface JobOpportunity {
  id: string;
  canonicalId: string;
  canonicalUrl: string;
  title: string;
  companyName: string;
  location: string | null;
  country: string | null;
  workplaceType: WorkplaceType;
  employmentType: string | null;
  description: string;
  postedAt: Date | null;
  sourceUpdatedAt: Date | null;
  lastSeenAt: Date;
  closedAt: Date | null;
  status: JobOpportunityStatus;
  createdAt: Date;
  updatedAt: Date;
}
