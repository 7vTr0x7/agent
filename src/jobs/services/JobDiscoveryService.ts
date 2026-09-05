import { Database } from "../../database/Database";
import { Job } from "../domain/Job";
import { JobSource } from "../sources/JobSource";

export interface DiscoveryResult {
  source: string;
  fetched: number;
  inserted: number;
  duplicates: number;
}

export class JobDiscoveryService {
  constructor(private readonly database: Database) {}

  async discover(source: JobSource): Promise<DiscoveryResult> {
    const jobs = await source.fetchJobs();

    let inserted = 0;
    let duplicates = 0;

    for (const job of jobs) {
      const result = await this.insertJob(job);

      if (result) {
        inserted++;
      } else {
        duplicates++;
      }
    }

    return {
      source: source.name,
      fetched: jobs.length,
      inserted,
      duplicates
    };
  }

  private async insertJob(job: Job): Promise<boolean> {
    const result = await this.database.query(
      `
        INSERT INTO jobs (
          source,
          source_job_id,
          url,
          title,
          company_name,
          location,
          employment_type,
          description,
          posted_at,
          content_hash,
          country,
          workplace_type,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT DO NOTHING
      `,
      [
        job.source,
        job.sourceJobId,
        job.url,
        job.title,
        job.companyName,
        job.location,
        job.employmentType,
        job.description,
        job.postedAt,
        job.contentHash,
        job.country,
        job.workplaceType,
        job.updatedAt
      ]
    );

    return result.rowCount === 1;
  }
}
