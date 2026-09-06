import { Database } from "../database/Database";
import { RecruiterContactCandidate } from "./RecruiterDiscovery";

export interface StoredRecruiterContact {
  id: string;
  companyName: string;
  companyDomain: string;
  email: string;
  fullName?: string;
  title?: string;
  department?: string;
  seniority?: string;
  country?: string;
  location?: string;
  confidence?: number;
  verified: boolean;
  verificationStatus?: string;
  provider: string;
}

export interface RecruiterDiscoveryRunRecord {
  id: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  contactsFound: number;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export class RecruiterDiscoveryRepository {
  constructor(private readonly database: Database) {}

  async upsertContact(
    companyName: string,
    companyDomain: string,
    candidate: RecruiterContactCandidate
  ): Promise<StoredRecruiterContact> {
    const domain = normalize(companyDomain).replace(/^www\./, "");
    const email = normalize(candidate.email);

    const result = await this.database.query<{
      id: string;
      company_name: string;
      company_domain: string;
      email: string;
      full_name: string | null;
      title: string | null;
      department: string | null;
      seniority: string | null;
      country: string | null;
      location: string | null;
      confidence: number | null;
      verified: boolean;
      verification_status: string | null;
      provider: string;
    }>(
      `
        INSERT INTO recruiter_contacts (
          company_name, company_domain, email, full_name, title, department,
          seniority, country, location, confidence, verified,
          verification_status, provider, last_seen_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
        ON CONFLICT (company_domain, email) DO UPDATE SET
          company_name = EXCLUDED.company_name,
          full_name = COALESCE(EXCLUDED.full_name, recruiter_contacts.full_name),
          title = COALESCE(EXCLUDED.title, recruiter_contacts.title),
          department = COALESCE(EXCLUDED.department, recruiter_contacts.department),
          seniority = COALESCE(EXCLUDED.seniority, recruiter_contacts.seniority),
          country = COALESCE(EXCLUDED.country, recruiter_contacts.country),
          location = COALESCE(EXCLUDED.location, recruiter_contacts.location),
          confidence = CASE
            WHEN recruiter_contacts.confidence IS NULL THEN EXCLUDED.confidence
            WHEN EXCLUDED.confidence IS NULL THEN recruiter_contacts.confidence
            ELSE GREATEST(recruiter_contacts.confidence, EXCLUDED.confidence)
          END,
          verified = recruiter_contacts.verified OR EXCLUDED.verified,
          verification_status = CASE
            WHEN EXCLUDED.verified THEN EXCLUDED.verification_status
            ELSE COALESCE(recruiter_contacts.verification_status, EXCLUDED.verification_status)
          END,
          provider = EXCLUDED.provider,
          last_seen_at = NOW(),
          updated_at = NOW()
        RETURNING id, company_name, company_domain, email, full_name, title,
          department, seniority, country, location, confidence, verified,
          verification_status, provider
      `,
      [
        companyName.trim(),
        domain,
        email,
        candidate.fullName ?? null,
        candidate.title ?? null,
        candidate.department ?? null,
        candidate.seniority ?? null,
        candidate.country ?? null,
        candidate.location ?? null,
        candidate.confidence ?? null,
        candidate.verified,
        candidate.verificationStatus ?? null,
        candidate.provider
      ]
    );

    const row = result.rows[0];
    if (!row) throw new Error("Recruiter contact could not be persisted.");

    return {
      id: row.id,
      companyName: row.company_name,
      companyDomain: row.company_domain,
      email: row.email,
      fullName: row.full_name ?? undefined,
      title: row.title ?? undefined,
      department: row.department ?? undefined,
      seniority: row.seniority ?? undefined,
      country: row.country ?? undefined,
      location: row.location ?? undefined,
      confidence: row.confidence ?? undefined,
      verified: row.verified,
      verificationStatus: row.verification_status ?? undefined,
      provider: row.provider
    };
  }

  async addSources(contactId: string, candidate: RecruiterContactCandidate): Promise<void> {
    for (const source of candidate.sources) {
      await this.database.query(
        `
          INSERT INTO recruiter_contact_sources (
            recruiter_contact_id, provider, source_url, source_type, confidence
          )
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (recruiter_contact_id, provider, source_url) DO UPDATE SET
            confidence = CASE
              WHEN recruiter_contact_sources.confidence IS NULL THEN EXCLUDED.confidence
              WHEN EXCLUDED.confidence IS NULL THEN recruiter_contact_sources.confidence
              ELSE GREATEST(recruiter_contact_sources.confidence, EXCLUDED.confidence)
            END
        `,
        [contactId, candidate.provider, source.url ?? null, source.type ?? null, source.confidence ?? null]
      );
    }
  }

  async startDiscoveryRun(input: {
    companyName: string;
    companyDomain: string;
    jobOpportunityId?: string;
    candidateProfileId: string;
    provider: string;
  }): Promise<RecruiterDiscoveryRunRecord> {
    const result = await this.database.query<{
      id: string;
    }>(
      `
        INSERT INTO recruiter_discovery_runs (
          company_name, company_domain, job_opportunity_id, candidate_profile_id, provider, status
        )
        VALUES ($1, $2, $3, $4, $5, 'RUNNING')
        RETURNING id
      `,
      [
        input.companyName.trim(),
        normalize(input.companyDomain).replace(/^www\./, ""),
        input.jobOpportunityId ?? null,
        input.candidateProfileId,
        input.provider
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Recruiter discovery run could not be created.");
    return { id: row.id, status: "RUNNING", contactsFound: 0 };
  }

  async finishDiscoveryRun(
    runId: string,
    status: "SUCCEEDED" | "FAILED" | "SKIPPED",
    contactsFound: number,
    error?: string
  ): Promise<void> {
    await this.database.query(
      `
        UPDATE recruiter_discovery_runs
        SET status = $2, contacts_found = $3, error = $4, completed_at = NOW()
        WHERE id = $1
      `,
      [runId, status, contactsFound, error ?? null]
    );
  }

  async hasRecentDiscovery(
    companyDomain: string,
    provider: string,
    cooldownHours: number
  ): Promise<boolean> {
    const result = await this.database.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM recruiter_discovery_runs
          WHERE company_domain = $1
            AND provider = $2
            AND status = 'SUCCEEDED'
            AND started_at >= NOW() - ($3 * INTERVAL '1 hour')
        ) AS exists
      `,
      [normalize(companyDomain).replace(/^www\./, ""), provider, cooldownHours]
    );
    return result.rows[0]?.exists ?? false;
  }

  async isOutreachSequenceDuplicate(
    recruiterContactId: string,
    jobOpportunityId: string,
    candidateProfileId: string
  ): Promise<boolean> {
    const result = await this.database.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM recruiter_outreach_sequences
          WHERE recruiter_contact_id = $1
            AND job_opportunity_id = $2
            AND candidate_profile_id = $3
            AND status <> 'FAILED'
        ) AS exists
      `,
      [recruiterContactId, jobOpportunityId, candidateProfileId]
    );
    return result.rows[0]?.exists ?? false;
  }
}
