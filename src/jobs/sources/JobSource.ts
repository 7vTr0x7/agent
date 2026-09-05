import { Job } from "../domain/Job";

export interface JobSource {
  readonly name: string;
  fetchJobs(): Promise<Job[]>;
}
