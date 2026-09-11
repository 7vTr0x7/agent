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

    const result = await this.database.query<any>(
      `INSERT INTO recruiter_contacts
        (company_name,company_domain,email,full_name,title,department,seniority,country,location,confidence,verified,verification_status,provider,linkedin_profile_url,identity_key,email_discovery_status,email_status,domain_status,mx_status,mailbox_evidence,verification_evidence,discovery_source,suppressed,email_discovery_attempted_at,last_seen_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,FALSE,NOW(),NOW(),NOW())
       ON CONFLICT (company_domain, identity_key) WHERE identity_key IS NOT NULL DO UPDATE SET
         company_name=EXCLUDED.company_name,
         email=COALESCE(EXCLUDED.email,recruiter_contacts.email),
         full_name=COALESCE(EXCLUDED.full_name,recruiter_contacts.full_name),
         title=COALESCE(EXCLUDED.title,recruiter_contacts.title),
         department=COALESCE(EXCLUDED.department,recruiter_contacts.department),
         seniority=COALESCE(EXCLUDED.seniority,recruiter_contacts.seniority),
         country=COALESCE(EXCLUDED.country,recruiter_contacts.country),
         location=COALESCE(EXCLUDED.location,recruiter_contacts.location),
         confidence=CASE WHEN recruiter_contacts.confidence IS NULL THEN EXCLUDED.confidence WHEN EXCLUDED.confidence IS NULL THEN recruiter_contacts.confidence ELSE GREATEST(recruiter_contacts.confidence,EXCLUDED.confidence) END,
         verified=recruiter_contacts.verified OR EXCLUDED.verified,
         verification_status=CASE WHEN EXCLUDED.verified THEN EXCLUDED.verification_status ELSE COALESCE(recruiter_contacts.verification_status,EXCLUDED.verification_status) END,
         provider=EXCLUDED.provider,
         linkedin_profile_url=COALESCE(EXCLUDED.linkedin_profile_url,recruiter_contacts.linkedin_profile_url),
         email_discovery_status=CASE WHEN EXCLUDED.email IS NOT NULL THEN 'FOUND' ELSE recruiter_contacts.email_discovery_status END,
         email_status=CASE WHEN EXCLUDED.email IS NOT NULL THEN EXCLUDED.email_status ELSE recruiter_contacts.email_status END,
         domain_status=EXCLUDED.domain_status,
         mx_status=CASE WHEN EXCLUDED.email_status IN ('LIKELY','VERIFIED') THEN 'EXISTS' ELSE recruiter_contacts.mx_status END,
         mailbox_evidence=recruiter_contacts.mailbox_evidence OR EXCLUDED.mailbox_evidence,
         verification_evidence=CASE WHEN EXCLUDED.verification_evidence='[]'::jsonb THEN recruiter_contacts.verification_evidence ELSE EXCLUDED.verification_evidence END,
         discovery_source=EXCLUDED.discovery_source,
         last_seen_at=NOW(),
         updated_at=NOW()
       RETURNING id,company_name,company_domain,email,full_name,title,department,seniority,country,location,confidence,verified,verification_status,provider,linkedin_profile_url,email_discovery_status,email_status,domain_status,mx_status,mailbox_evidence,verification_evidence,discovery_source,suppressed,suppression_reason,last_contacted_at,email_discovery_attempted_at,updated_at`,
      [
        companyName.trim(), domain, email, fullName, candidate.title ?? null, candidate.department ?? null,
        candidate.seniority ?? null, candidate.country ?? null, candidate.location ?? null,
        candidate.confidence ?? null, verified, candidate.verificationStatus ?? null,
        candidate.provider, profileUrl, identityKey, email ? "FOUND" : "PENDING", emailStatus,
        domainStatus, mxStatus, verified, evidence, candidate.provider
      ]
    );

    const row = result.rows[0];
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
         identity_key=CASE WHEN linkedin_profile_url IS NOT NULL THEN identity_key ELSE CONCAT('email:',$2::text) END,
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
