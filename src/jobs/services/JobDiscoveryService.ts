import { Database } from "../../database/Database";
import { canonicalizeJobUrl, createCanonicalJobId, createJobContentFingerprint } from "../domain/JobCanonicalization";
import { Job } from "../domain/Job";
import { JobSource } from "../sources/JobSource";
import { evaluateJobEligibility, JobSearchPolicy } from "../policy/JobEligibility";

export interface DiscoveryResult {
  source: string;
  fetched: number;
  normalized: number;
  hardRejected: number;
  ambiguous: number;
  eligible: number;
  inserted: number;
  duplicates: number;
  insertedOpportunityIds: string[];
  rejectionReasons: Record<string, number>;
  acceptedRoleFamilies: Record<string, number>;
  rejectedSamples: Array<{ sourceJobId: string; title: string; classification: string; reason: string }>;
}
interface OpportunityRow { id: string; }

export class JobDiscoveryService {
  constructor(private readonly database: Database, private readonly policy: JobSearchPolicy) {}

  async discover(source: JobSource, signal?: AbortSignal): Promise<DiscoveryResult> {
    if (signal?.aborted) throw new Error("Discovery aborted before source execution");
    const jobs = await source.fetchJobs(signal);
    if (signal?.aborted) throw new Error("Discovery aborted after source execution");

    let inserted = 0; let duplicates = 0; let hardRejected = 0; let ambiguous = 0; let eligible = 0;
    const insertedOpportunityIds: string[] = [];
    const rejectionReasons: Record<string, number> = {};
    const acceptedRoleFamilies: Record<string, number> = {};
    const rejectedSamples: Array<{ sourceJobId: string; title: string; classification: string; reason: string }> = [];

    for (const job of jobs) {
      if (signal?.aborted) throw new Error("Discovery aborted during persistence");
      const eligibility = evaluateJobEligibility({
        companyName: job.companyName,
        title: job.title,
        description: job.description,
        location: job.location,
        country: job.country,
        workplaceType: job.workplaceType,
        postedAt: job.postedAt
      }, this.policy);
      if (eligibility.decision === "REJECT") {
        hardRejected++;
        const key = eligibility.reason.split(".")[0] || "RELEVANCE_REJECTED";
        rejectionReasons[key] = (rejectionReasons[key] ?? 0) + 1;
        if (rejectedSamples.length < 10) rejectedSamples.push({ sourceJobId: job.sourceJobId, title: job.title.slice(0, 200), classification: eligibility.classification, reason: eligibility.reason.slice(0, 300) });
        continue;
      }
      eligible++;
      if (eligibility.classification === "AMBIGUOUS") ambiguous++;
      const roleFamily = eligibility.matchedSignals[0] ?? eligibility.classification;
      acceptedRoleFamilies[roleFamily] = (acceptedRoleFamilies[roleFamily] ?? 0) + 1;

      const result = await this.persistJob(job);
      if (result.inserted) { inserted++; insertedOpportunityIds.push(result.opportunityId); } else duplicates++;
    }

    return {
      source: source.name,
      fetched: jobs.length,
      normalized: jobs.length,
      hardRejected,
      ambiguous,
      eligible,
      inserted,
      duplicates,
      insertedOpportunityIds,
      rejectionReasons,
      acceptedRoleFamilies,
      rejectedSamples
    };
  }

  private async persistJob(job: Job): Promise<{ inserted: boolean; opportunityId: string }> {
    const canonicalUrl = canonicalizeJobUrl(job.url);
    const canonicalId = createCanonicalJobId(job.url);
    const contentFingerprint = createJobContentFingerprint(job);
    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [contentFingerprint]);

      const existingByContent = await client.query<OpportunityRow>(
        `
          SELECT id
          FROM job_opportunities
          WHERE lower(trim(title)) = lower(trim($1))
            AND lower(trim(company_name)) = lower(trim($2))
            AND lower(trim(COALESCE(location, ''))) = lower(trim(COALESCE($3, '')))
            AND md5(COALESCE(description, '')) = md5($4)
          ORDER BY last_seen_at DESC
          LIMIT 1
        `,
        [job.title, job.companyName, job.location, job.description]
      );

      const existing = existingByContent.rows[0];
      if (existing) {
        await client.query(
          `
            INSERT INTO job_observations (
              job_opportunity_id, platform, source_type, source_job_id, source_url,
              discovered_at, observed_at, raw_payload, content_hash
            ) VALUES ($1,$2,$3,$4,$5,NOW(),NOW(),$6::jsonb,$7)
            ON CONFLICT DO NOTHING
          `,
          [existing.id, job.source, "adapter", job.sourceJobId, job.url, JSON.stringify(job), job.contentHash]
        );
        return { inserted: false, opportunityId: existing.id };
      }

      const opportunityResult = await client.query<OpportunityRow>(
        `
          INSERT INTO job_opportunities (
            canonical_id, canonical_url, title, company_name, company_domain, location,
            country, workplace_type, employment_type, description, posted_at, updated_at,
            last_seen_at, status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,NOW()),NOW(),'ACTIVE')
          ON CONFLICT (canonical_id)
          DO UPDATE SET
            canonical_url = EXCLUDED.canonical_url,
            title = EXCLUDED.title,
            company_name = EXCLUDED.company_name,
            company_domain = COALESCE(EXCLUDED.company_domain, job_opportunities.company_domain),
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
        [canonicalId, canonicalUrl, job.title, job.companyName, job.companyDomain ?? null, job.location, job.country, job.workplaceType, job.employmentType, job.description, job.postedAt, job.updatedAt]
      );
      const opportunity = opportunityResult.rows[0];
      if (!opportunity) throw new Error("Failed to persist job opportunity");

      const observationResult = await client.query(
        `
          INSERT INTO job_observations (
            job_opportunity_id, platform, source_type, source_job_id, source_url,
            discovered_at, observed_at, raw_payload, content_hash
          ) VALUES ($1,$2,$3,$4,$5,NOW(),NOW(),$6::jsonb,$7)
          ON CONFLICT DO NOTHING RETURNING id
        `,
        [opportunity.id, job.source, "adapter", job.sourceJobId, job.url, JSON.stringify(job), job.contentHash]
      );
      return { inserted: observationResult.rowCount === 1, opportunityId: opportunity.id };
    });
  }
}
