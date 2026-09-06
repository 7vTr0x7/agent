import { Database } from "../../database/Database";
import { JobOpportunity } from "./JobOpportunity";
import { JobOpportunityRepository } from "./JobOpportunityRepository";

interface JobOpportunityRow {
  id: string; canonical_id: string; canonical_url: string; title: string; company_name: string; company_domain: string | null;
  location: string | null; country: string | null; workplace_type: JobOpportunity["workplaceType"]; employment_type: string | null;
  description: string; posted_at: Date | null; source_updated_at: Date | null; last_seen_at: Date; closed_at: Date | null;
  status: JobOpportunity["status"]; created_at: Date; updated_at: Date;
}
export class PostgresJobOpportunityRepository implements JobOpportunityRepository {
  constructor(private readonly database: Database) {}
  async findById(id: string): Promise<JobOpportunity | null> { const result = await this.database.query<JobOpportunityRow>(`${selectSql} WHERE id = $1`, [id]); return result.rows[0] ? mapJobOpportunity(result.rows[0]) : null; }
  async findByCanonicalId(canonicalId: string): Promise<JobOpportunity | null> { const result = await this.database.query<JobOpportunityRow>(`${selectSql} WHERE canonical_id = $1`, [canonicalId]); return result.rows[0] ? mapJobOpportunity(result.rows[0]) : null; }
  async save(opportunity: JobOpportunity): Promise<JobOpportunity> {
    const result = await this.database.query<JobOpportunityRow>(`INSERT INTO job_opportunities (id, canonical_id, canonical_url, title, company_name, company_domain, location, country, workplace_type, employment_type, description, posted_at, updated_at, last_seen_at, closed_at, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO UPDATE SET canonical_id=EXCLUDED.canonical_id, canonical_url=EXCLUDED.canonical_url, title=EXCLUDED.title, company_name=EXCLUDED.company_name, company_domain=COALESCE(EXCLUDED.company_domain, job_opportunities.company_domain), location=EXCLUDED.location, country=EXCLUDED.country, workplace_type=EXCLUDED.workplace_type, employment_type=EXCLUDED.employment_type, description=EXCLUDED.description, posted_at=EXCLUDED.posted_at, updated_at=EXCLUDED.updated_at, last_seen_at=EXCLUDED.last_seen_at, closed_at=EXCLUDED.closed_at, status=EXCLUDED.status RETURNING id, canonical_id, canonical_url, title, company_name, company_domain, location, country, workplace_type, employment_type, description, posted_at, updated_at AS source_updated_at, last_seen_at, closed_at, status, created_at, updated_at`, [opportunity.id, opportunity.canonicalId, opportunity.canonicalUrl, opportunity.title, opportunity.companyName, opportunity.companyDomain ?? null, opportunity.location, opportunity.country, opportunity.workplaceType, opportunity.employmentType, opportunity.description, opportunity.postedAt, opportunity.updatedAt, opportunity.lastSeenAt, opportunity.closedAt, opportunity.status]);
    const row = result.rows[0]; if (!row) throw new Error("Failed to persist job opportunity"); return mapJobOpportunity(row);
  }
}
const selectColumns = `id, canonical_id, canonical_url, title, company_name, company_domain, location, country, workplace_type, employment_type, description, posted_at, updated_at AS source_updated_at, last_seen_at, closed_at, status, created_at, updated_at`;
const selectSql = `SELECT ${selectColumns} FROM job_opportunities`;
function mapJobOpportunity(row: JobOpportunityRow): JobOpportunity {
  return { id: row.id, canonicalId: row.canonical_id, canonicalUrl: row.canonical_url, title: row.title, companyName: row.company_name, ...(row.company_domain ? { companyDomain: row.company_domain } : {}), location: row.location, country: row.country, workplaceType: row.workplace_type, employmentType: row.employment_type, description: row.description, postedAt: row.posted_at, sourceUpdatedAt: row.source_updated_at, lastSeenAt: row.last_seen_at, closedAt: row.closed_at, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}
