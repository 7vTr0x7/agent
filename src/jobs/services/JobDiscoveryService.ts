import { Database } from "../../database/Database";
import {
  canonicalizeJobUrl,
  createCanonicalJobId
} from "../domain/JobCanonicalization";
import { Job } from "../domain/Job";
import { JobSource } from "../sources/JobSource";

export interface DiscoveryResult {
  source: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  insertedOpportunityIds: string[];
}

interface OpportunityRow {
  id: string;
}

export class JobDiscoveryService {
  constructor(private readonly database: Database) {}

  async discover(source: JobSource): Promise<DiscoveryResult> {
    const jobs = await source.fetchJobs();

    let inserted = 0;
    let duplicates = 0;
    const insertedOpportunityIds: string[] = [];

    for (const job of jobs) {
      const result = await this.persistJob(job);

      if (result.inserted) {
        inserted++;
        insertedOpportunityIds.push(result.opportunityId);
      } else {
        duplicates++;
      }
    }

    return {
      source: source.name,
      fetched: jobs.length,
      inserted,
      duplicates,
      insertedOpportunityIds
    };
  }

  private async persistJob(
    job: Job
  ): Promise<{ inserted: boolean; opportunityId: string }> {
    const canonicalUrl = canonicalizeJobUrl(job.url);
    const canonicalId = createCanonicalJobId(job.url);

    return this.database.transaction(async (client) => {
      const opportunityResult = await client.query<OpportunityRow>(
        `
          INSERT INTO job_opportunities (
            canonical_id,
            canonical_url,
            title,
            company_name,
            location,
            country,
            workplace_type,
            employment_type,
            description,
            posted_at,
            updated_at,
            last_seen_at,
            status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),'ACTIVE')
          ON CONFLICT (canonical_id)
          DO UPDATE SET
            canonical_url = EXCLUDED.canonical_url,
            title = EXCLUDED.title,
            company_name = EXCLUDED.company_name,
            location = EXCLUDED.location,
            country = EXCLUDED.country,
            workplace_type = EXCLUDED.workplace_type,
            employment_type = EXCLUDED.employment_type,
            description = EXCLUDED.description,
            posted_at = COALESCE(EXCLUDED.posted_at, job_opportunities.posted_at),
            updated_at = EXCLUDED.updated_at,
            last_seen_at = NOW(),
            status = 'ACTIVE',
            closed_at = NULL
          RETURNING id
        `,
        [
          canonicalId,
          canonicalUrl,
          job.title,
          job.companyName,
          job.location,
          job.country,
          job.workplaceType,
          job.employmentType,
          job.description,
          job.postedAt,
          job.updatedAt
        ]
      );

      const opportunity = opportunityResult.rows[0];

      if (!opportunity) {
        throw new Error("Failed to persist job opportunity");
      }

      const observationResult = await client.query(
        `
          INSERT INTO job_observations (
            job_opportunity_id,
            platform,
            source_type,
            source_job_id,
            source_url,
            discovered_at,
            observed_at,
            raw_payload,
            content_hash
          )
          VALUES ($1,$2,$3,$4,NOW(),NOW(),$5::jsonb,$6)
          ON CONFLICT DO NOTHING
          RETURNING id
        `,
        [
          opportunity.id,
          job.source,
          "adapter",
          job.sourceJobId,
          job.url,
          JSON.stringify(job),
          job.contentHash
        ]
      );

      return {
        inserted: observationResult.rowCount === 1,
        opportunityId: opportunity.id
      };
    });
  }
}
