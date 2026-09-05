import { JobOpportunity } from "../domain/JobOpportunity";

export interface JobOpportunityRepository {
  findById(id: string): Promise<JobOpportunity | null>;
  findByCanonicalId(canonicalId: string): Promise<JobOpportunity | null>;
  save(opportunity: JobOpportunity): Promise<JobOpportunity>;
}
