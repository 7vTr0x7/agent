import { Database } from "../database/Database";
import { RecruiterIdentityCandidate } from "./RecruiterDiscovery";

export interface StoredRecruiterIdentity {
  id: string;
  companyName: string;
  companyDomain: string;
  email: string | null;
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
  linkedinProfileUrl?: string;
  emailDiscoveryStatus: "PENDING" | "FOUND" | "NOT_FOUND" | "INVALID";
  emailDiscoveryAttemptedAt?: Date;
  updatedAt?: Date;
}

const normalize = (value: string): string => value.trim().toLowerCase();
const normalizeDomain = (value: string): string => normalize(value).replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";

export class RecruiterIdentityRepository {
  constructor(private readonly database: Database) {}

  async upsertIdentity(companyName: string, companyDomain: string, candidate: RecruiterIdentityCandidate): Promise<StoredRecruiterIdentity> {
    const domain = normalizeDomain(companyDomain);
    const email = candidate.email?.trim().toLowerCase() || null;
    const profileUrl = candidate.linkedinProfileUrl?.trim() || null;
    const fullName = candidate.fullName?.trim() || null;
    const identityKey = profileUrl
      ? `profile:${profileUrl.toLowerCase()}`
      : email
        ? `email:${email}`
        : `name:${normalize(fullName ?? "")}|title:${normalize(candidate.title ?? "")}`;

    const inserted = await this.database.query<any>(
      `INSERT INTO recruiter_contacts
        (company_name,company_domain,email,full_name,title,department,seniority,country,location,confidence,verified,verification_status,provider,linkedin_profile_url,identity_key,email_discovery_status,email_discovery_attempted_at,last_seen_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW(),NOW())
       ON CONFLICT DO NOTHING
       RETURNING id,company_name,company_domain,email,full_name,title,department,seniority,country,location,confidence,verified,verification_status,provider,linkedin_profile_url,email_discovery_status,email_discovery_attempted_at,updated_at`,
      [
        companyName.trim(), domain, email, fullName, candidate.title ?? null, candidate.department ?? null,
        candidate.seniority ?? null, candidate.country ?? null, candidate.location ?? null,
        candidate.confidence ?? null, candidate.verified, candidate.verificationStatus ?? null,
        candidate.provider, profileUrl, identityKey, email ? "FOUND" : "PENDING"
      ]
    );

    let row = inserted.rows[0];
    if (!row) {
      const existing = await this.database.query<any>(
        `SELECT id FROM recruiter_contacts
         WHERE company_domain=$1
           AND (
             ($2 IS NOT NULL AND LOWER(linkedin_profile_url)=LOWER($2))
             OR ($3 IS NOT NULL AND LOWER(email)=LOWER($3))
             OR ($4 IS NOT NULL AND LOWER(full_name)=LOWER($4))
             OR identity_key=$5
           )
         ORDER BY CASE
           WHEN $2 IS NOT NULL AND LOWER(linkedin_profile_url)=LOWER($2) THEN 1
           WHEN $3 IS NOT NULL AND LOWER(email)=LOWER($3) THEN 2
           WHEN $4 IS NOT NULL AND LOWER(full_name)=LOWER($4) THEN 3
           ELSE 4 END
         LIMIT 1`,
        [domain, profileUrl, email, fullName, identityKey]
      );
      const id = existing.rows[0]?.id;
      if (!id) throw new Error("Recruiter identity could not be deduplicated after insert conflict.");
      row = (await this.database.query<any>(
        `UPDATE recruiter_contacts SET
           company_name=$2,
           email=COALESCE($3,email),
           full_name=COALESCE($4,full_name),
           title=COALESCE($5,title),
           department=COALESCE($6,department),
           seniority=COALESCE($7,seniority),
           country=COALESCE($8,country),
           location=COALESCE($9,location),
           confidence=CASE WHEN confidence IS NULL THEN $10 WHEN $10 IS NULL THEN confidence ELSE GREATEST(confidence,$10) END,
           verified=verified OR $11,
           verification_status=CASE WHEN $11 THEN $12 ELSE COALESCE(verification_status,$12) END,
           provider=$13,
           linkedin_profile_url=COALESCE($14,linkedin_profile_url),
           identity_key=CASE WHEN $14 IS NOT NULL THEN $15 ELSE identity_key END,
           email_discovery_status=CASE WHEN $3 IS NOT NULL THEN 'FOUND' ELSE email_discovery_status END,
           last_seen_at=NOW(),updated_at=NOW()
         WHERE id=$1
         RETURNING id,company_name,company_domain,email,full_name,title,department,seniority,country,location,confidence,verified,verification_status,provider,linkedin_profile_url,email_discovery_status,email_discovery_attempted_at,updated_at`,
        [id, companyName.trim(), email, fullName, candidate.title ?? null, candidate.department ?? null,
          candidate.seniority ?? null, candidate.country ?? null, candidate.location ?? null,
          candidate.confidence ?? null, candidate.verified, candidate.verificationStatus ?? null,
          candidate.provider, profileUrl, identityKey]
      )).rows[0];
    }

    if (!row) throw new Error("Recruiter identity could not be persisted.");
    return this.map(row);
  }

  async markEmailDiscovery(contactId: string, status: "FOUND" | "NOT_FOUND" | "INVALID"): Promise<void> {
    await this.database.query(
      `UPDATE recruiter_contacts SET email_discovery_status=$2,email_discovery_attempted_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [contactId, status]
    );
  }

  async enrichEmail(contactId: string, email: string, verified: boolean, verificationStatus?: string, confidence?: number): Promise<StoredRecruiterIdentity | null> {
    const normalized = normalize(email);
    const result = await this.database.query<any>(
      `UPDATE recruiter_contacts SET
         email=$2,
         email_discovery_status='FOUND',
         email_discovery_attempted_at=NOW(),
         verified=verified OR $3,
         verification_status=CASE WHEN $3 THEN $4 ELSE verification_status END,
         confidence=CASE WHEN confidence IS NULL THEN $5 WHEN $5 IS NULL THEN confidence ELSE GREATEST(confidence,$5) END,
         identity_key=CASE WHEN linkedin_profile_url IS NOT NULL THEN identity_key ELSE CONCAT('email:',$2) END,
         last_seen_at=NOW(),updated_at=NOW()
       WHERE id=$1
       RETURNING id,company_name,company_domain,email,full_name,title,department,seniority,country,location,confidence,verified,verification_status,provider,linkedin_profile_url,email_discovery_status,email_discovery_attempted_at,updated_at`,
      [contactId, normalized, verified, verificationStatus ?? null, confidence ?? null]
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async addSources(contactId: string, candidate: RecruiterIdentityCandidate): Promise<void> {
    for (const source of candidate.sources ?? []) {
      await this.database.query(
        `INSERT INTO recruiter_contact_sources (recruiter_contact_id,provider,source_url,source_type,confidence)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (recruiter_contact_id,provider,(COALESCE(source_url,''))) DO UPDATE SET
           confidence=CASE WHEN recruiter_contact_sources.confidence IS NULL THEN EXCLUDED.confidence
             WHEN EXCLUDED.confidence IS NULL THEN recruiter_contact_sources.confidence
             ELSE GREATEST(recruiter_contact_sources.confidence,EXCLUDED.confidence) END`,
        [contactId, candidate.provider, source.url ?? null, source.type ?? null, source.confidence ?? null]
      );
    }
  }

  private map(row: any): StoredRecruiterIdentity {
    return {
      id: row.id,
      companyName: row.company_name,
      companyDomain: row.company_domain,
      email: row.email ?? null,
      fullName: row.full_name ?? undefined,
      title: row.title ?? undefined,
      department: row.department ?? undefined,
      seniority: row.seniority ?? undefined,
      country: row.country ?? undefined,
      location: row.location ?? undefined,
      confidence: row.confidence ?? undefined,
      verified: Boolean(row.verified),
      verificationStatus: row.verification_status ?? undefined,
      provider: row.provider,
      linkedinProfileUrl: row.linkedin_profile_url ?? undefined,
      emailDiscoveryStatus: row.email_discovery_status,
      emailDiscoveryAttemptedAt: row.email_discovery_attempted_at ?? undefined,
      updatedAt: row.updated_at ?? undefined
    };
  }
}
