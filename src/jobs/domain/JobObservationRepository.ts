import { JobObservation } from "../domain/JobObservation";

export interface JobObservationRepository {
  findBySourceJob(
    platform: string,
    sourceJobId: string
  ): Promise<JobObservation | null>;
  save(observation: JobObservation): Promise<JobObservation>;
}
