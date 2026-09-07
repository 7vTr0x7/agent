import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";

/**
 * Keeps discovery available when a public provider's primary endpoint is
 * temporarily unreachable. The fallback is only used after the primary
 * source fails; successful primary responses are returned unchanged.
 */
export class FallbackJobSource implements JobSource {
  readonly name: string;

  constructor(
    private readonly primary: JobSource,
    private readonly fallback: JobSource
  ) {
    this.name = primary.name;
  }

  async fetchJobs(): Promise<Job[]> {
    try {
      return await this.primary.fetchJobs();
    } catch (primaryError) {
      try {
        const jobs = await this.fallback.fetchJobs();
        return jobs.map((job) => ({ ...job, source: this.name }));
      } catch (fallbackError) {
        const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`${this.name} primary and fallback sources failed: primary=${primaryMessage}; fallback=${fallbackMessage}`);
      }
    }
  }
}
