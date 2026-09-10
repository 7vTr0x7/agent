import { Job } from "../domain/Job";

export interface JobSource {
  readonly name: string;

  /**
   * Fetch jobs, honoring the supplied signal when the source performs network
   * or other cancellable work. The parameter is optional so existing sources
   * remain source-compatible while cancellation is rolled out incrementally.
   */
  fetchJobs(signal?: AbortSignal): Promise<Job[]>;
}
