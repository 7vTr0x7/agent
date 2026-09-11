import { Database } from "../database/Database";
import { RecruiterIdentityCandidate } from "./RecruiterDiscovery";

export type RecruiterEmailStatus = "VERIFIED" | "LIKELY" | "UNVERIFIED" | "INVALID" | "SUPPRESSED";
export type RecruiterDomainStatus = "VALID" | "INVALID" | "UNKNOWN";
export type RecruiterMxStatus = "EXISTS" | "MISSING" | "UNKNOWN";

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
  emailStatus?: RecruiterEmailStatus;
  domainStatus?: RecruiterDomainStatus;
  mxStatus?: RecruiterMxStatus;
  mailboxEvidence?: boolean;
  verificationEvidence?: unknown[];
  suppressed?: boolean;
  suppressionReason?: string;
  lastContactedAt?: Date;
  emailDiscoveryAttemptedAt?: Date;
  updatedAt?: Date;
}

const normalize = (value: string): string => value.trim().toLowerCase();
const normalizeDomain = (value: string): string => normalize(value).replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";

function deriveEmailStatus(candidate: RecruiterIdentityCandidate): RecruiterEmailStatus {
  if (!candidate.email) return "UNVERIFIED";
  if (candidate.verificationStatus === "VERIFIED" || candidate.verificationStatus === "mailbox_verified") return "VERIFIED";
  if (candidate.verificationStatus === "LIKELY" || candidate.verificationStatus === "domain_mx_verified" || candidate.verificationStatus === "domain_mx_verified_doh") return "LIKELY";
  if (candidate.verificationStatus === "INVALID" || candidate.verificationStatus === "invalid_email_format" || candidate.verificationStatus === "no_mx_record" || candidate.verificationStatus === "missing_email_domain") return "INVALID";
  return "UNVERIFIED";
}

function hasMailboxVerification(candidate: RecruiterIdentityCandidate): boolean {
  return candidate.verified && (candidate.verificationStatus === "VERIFIED" || candidate.verificationStatus === "mailbox_verified");
}

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
    const emailStatus = deriveEmailStatus(candidate);
    const verified = hasMailboxVerification(candidate);
    const domainStatus: RecruiterDomainStatus = email && !email.endsWith(`@${domain}`) ? "INVALID" : "VALID";
    const mxStatus: RecruiterMxStatus = emailStatus === "LIKELY" || emailStatus === "VERIFIED" ? "EXISTS" : "UNKNOWN";
    const evidence = JSON.stringify([
      ...(candidate.discoveryEvidence ?? []),
      ...(candidate.recruitingContext ? [candidate.recruitingContext] : []),
      ...(candidate.sources ?? []).map((source) => ({ url: source.url ?? null, type: source.type ?? null, confidence: source.confidence ?? null }))
    ]);

    const inserted = await this.database.query<any>(
      `INSERT INTO recruiter_contacts
        (company_name,company_domain,email,full_name,title,department,seniority,country,location,confidence,verified,verification_status,provider,linkedin_profile_url,identity_key,email_discovery_status,email_status,domain_status,mx_status,mailbox_evidence,verification_evidence,discovery_source,suppressed,email_discovery_attempted_at,last_seen_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,FALSE,NOW(),NOW(),NOW())
       ON CONFLICT DO NOTHING
       RETURNING id,company_name,company_domain,email,full_name,title,department,seniority,country,location,confidence,verified,verification_status,provider,linkedin_profile_url,email_discovery_status,email_status,domain_status,mx_status,mailbox_evidence,verification_evidence,discovery_source,suppressed,suppression_reason,last_contacted_at,email_discovery_attempted_at,updated_at`,
      [
        companyName.trim(), domain, email, fullName, candidate.title ?? null, candidate.department ?? null,
        candidate.seniority ?? null, candidate.country ?? null, candidate.location ?? null,
        candidate.confidence ?? null, verified, candidate.verificationStatus ?? null,
        candidate.provider, profileUrl, identityKey, email ? "FOUND" : "PENDING", emailStatus,
        domainStatus, mxStatus, verified, evidence, candidate.provider
      ]
    );

    let row = inserted.rows[0];
    if (!row) {
      const existing = await this.database.query<any>(
        `SELECT id FROM recruiter_contacts
         WHERE company_domain=$1
           AND (
             ($2::text IS NOT NULL AND LOWER(linkedin_profile_url)=LOWER($2::text))
             OR ($3::text IS NOT NULL AND LOWER(email)=LOWER($3::text))
             OR ($4::text IS NOT NULL AND LOWER(full_name)=LOWER($4::text))
             OR identity_key=$5
           )
         ORDER BY CASE
           WHEN $2::text IS NOT NULL AND LOWER(linkedin_profile_url)=LOWER($2::text) THEN 1
           WHEN $3::text IS NOT NULL AND LOWER(email)=LOWER($3::text) THEN 2
           WHEN $4::text IS NOT NULL AND LOWER(full_name)=LOWER($4::text) THEN 3
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
           email_status=CASE WHEN $3 IS NOT NULL THEN $16 ELSE email_status END,
           domain_status=$17,
           mx_status=CASE WHEN $16 IN ('LIKELY','VERIFIED') THEN 'EXISTS' ELSE mx_status END,
           mailbox_evidence=mailbox_evidence OR $18,
           verification_evidence=CASE WHEN $19::jsonb='[]'::jsonb THEN verification_evidence ELSE $19::jsonb END,
           discovery_source=COALESCE($13,discovery_source),
           last_seen_at=NOW(),updated_at=NOW()
         WHERE id=$1
         RETURNING id,company_name,company_domain,email,full_name,title,department,seniority,country,location,confidence,verified,verification_status,provider,linkedin_profile_url,email_discovery_status,email_status,domain_status,mx_status,mailbox_evidence,verification_evidence,discovery_source,suppressed,suppression_reason,last_contacted_at,email_discovery_attempted_at,updated_at`,
        [id, companyName.trim(), email, fullName, candidate.title ?? null, candidate.department ?? null,
          candidate.seniority ?? null, candidate.country ?? null, candidate.location ?? null,
          candidate.confidence ?? null, verified, candidate.verificationStatus ?? null,
          candidate.provider, profileUrl, identityKey, emailStatus, domainStatus,
          verified, evidence]
      )).rows[0];
    }

    if (!row) throw new Error("Recruiter identity could not be persisted.");
    return this.map(row);
  }

  async markEmailDiscovery(contactId: string, status: "FOUND" | "NOT_FOUND" | "INVALID"): Promise<void> {
    const emailStatus: RecruiterEmailStatus = status === "FOUND" ? "UNVERIFIED" : status === "INVALID" ? "INVALID" : "UNVERIFIED";
    await this.database.query(
      `UPDATE recruiter_contacts SET email_discovery_status=$2,email_status=$3,email_discovery_attempted_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [contactId, status, emailStatus]
    );
  }

  async enrichEmail(contactId: string, email: string, verified: boolean, verificationStatus?: string, confidence?: number): Promise<StoredRecruiterIdentity | null> {
    const normalized = normalize(email);
    const emailStatus: RecruiterEmailStatus = verified || verificationStatus === "VERIFIED" ? "VERIFIED" : verificationStatus === "LIKELY" || verificationStatus === "domain_mx_verified" || verificationStatus === "domain_mx_verified_doh" ? "LIKELY" : verificationStatus === "INVALID" || verificationStatus === "no_mx_record" ? "INVALID" : "UNVERIFIED";
    const domainStatus: RecruiterDomainStatus = "VALID";
    const mxStatus: RecruiterMxStatus = emailStatus === "LIKELY" || emailStatus === "VERIFIED" ? "EXISTS" : emailStatus === "INVALID" ? "MISSING" : "UNKNOWN";
    const mailboxEvidence = emailStatus === "VERIFIED";
    const result = await this.database.query<any>(
      `UPDATE recruiter_contacts SET
         email=$2,
         email_discovery_status='FOUND',
         email_discovery_attempted_at=NOW(),
         verified=verified OR $3,
         verification_status=$4,
         email_status=$5,
         domain_status=$6,
         mx_status=$7,
         mailbox_evidence=mailbox_evidence OR $8,
         verification_evidence=verification_evidence || $9::jsonb,
         identity_key=CASE WHEN linkedin_profile_url IS NOT NULL THEN identity_key ELSE CONCAT('email:',$2) END,
         last_seen_at=NOW(),updated_at=NOW()
       WHERE id=$1
       RETURNING id,company_name,company_domain,email,full_name,title,department,seniority,country,location,confidence,verified,verification_status,provider,linkedin_profile_url,email_discovery_status,email_status,domain_status,mx_status,mailbox_evidence,verification_evidence,discovery_source,suppressed,suppression_reason,last_contacted_at,email_discovery_attempted_at,updated_at`,
      [contactId, normalized, verified, verificationStatus ?? null, emailStatus, domainStatus, mxStatus, mailboxEvidence, JSON.stringify([{ status: verificationStatus ?? "UNVERIFIED", confidence: confidence ?? null }])]
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
      emailStatus: row.email_status ?? undefined,
      domainStatus: row.domain_status ?? "UNKNOWN",
      mxStatus: row.mx_status ?? "UNKNOWN",
      mailboxEvidence: Boolean(row.mailbox_evidence),
      verificationEvidence: Array.isArray(row.verification_evidence) ? row.verification_evidence : [],
      suppressed: Boolean(row.suppressed),
      suppressionReason: row.suppression_reason ?? undefined,
      lastContactedAt: row.last_contacted_at ?? undefined,
      emailDiscoveryAttemptedAt: row.email_discovery_attempted_at ?? undefined,
      updatedAt: row.updated_at ?? undefined
    };
  }
}
