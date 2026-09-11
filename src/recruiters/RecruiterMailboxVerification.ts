export type CanonicalMailboxVerificationStatus = "VERIFIED" | "LIKELY" | "UNVERIFIED" | "INVALID";
export type CanonicalRecruiterRelevanceStatus = "CURRENT" | "RECENT" | "HISTORICAL" | "UNKNOWN";

export interface RecruiterMailboxVerificationRecord {
  verified?: boolean | null;
  verificationStatus?: string | null;
  emailStatus?: string | null;
  mailboxEvidence?: boolean | null;
  verificationEvidence?: unknown[] | null;
  suppressed?: boolean | null;
  relevanceStatus?: string | null;
}

const VERIFIED_STATUS = "mailbox_verified";
const LEGACY_UNSAFE_STATUSES = new Set([
  "verified_public_source",
  "domain_mx_verified",
  "domain_mx_verified_doh",
  "unverified_public_source",
  "verified_mailbox",
  "valid"
]);

export function normalizeMailboxVerificationStatus(status: string | null | undefined): CanonicalMailboxVerificationStatus {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (normalized === VERIFIED_STATUS || normalized === "verified" || normalized === "mailbox_verified") return "VERIFIED";
  if (normalized === "likely" || normalized === "domain_mx_verified" || normalized === "domain_mx_verified_doh") return "LIKELY";
  if (normalized === "invalid" || normalized === "invalid_email_format" || normalized === "no_mx_record" || normalized === "missing_email_domain" || normalized === "not_valid") return "INVALID";
  return "UNVERIFIED";
}

export function isMailboxVerifiedForRealSend(record: RecruiterMailboxVerificationRecord): boolean {
  return record.verified === true
    && record.mailboxEvidence === true
    && Array.isArray(record.verificationEvidence)
    && record.verificationEvidence.length > 0
    && String(record.emailStatus ?? "").toUpperCase() === "VERIFIED"
    && normalizeMailboxVerificationStatus(record.verificationStatus) === "VERIFIED"
    && !LEGACY_UNSAFE_STATUSES.has(String(record.verificationStatus ?? "").trim().toLowerCase());
}

export function isRecruiterRelevantForRealSend(record: RecruiterMailboxVerificationRecord): boolean {
  const relevance = String(record.relevanceStatus ?? "UNKNOWN").trim().toUpperCase();
  return relevance === "CURRENT" || relevance === "RECENT";
}

export function isEligibleForRealRecruiterSend(record: RecruiterMailboxVerificationRecord): boolean {
  return isMailboxVerifiedForRealSend(record)
    && isRecruiterRelevantForRealSend(record)
    && record.suppressed !== true;
}

/** Canonical SQL predicate for database-backed real-send eligibility. */
export function recruiterRealSendEligibilitySql(alias = "c"): string {
  return `COALESCE(${alias}.verified,FALSE)=TRUE
    AND COALESCE(${alias}.mailbox_evidence,FALSE)=TRUE
    AND jsonb_typeof(COALESCE(${alias}.verification_evidence,'[]'::jsonb))='array'
    AND jsonb_array_length(CASE WHEN jsonb_typeof(COALESCE(${alias}.verification_evidence,'[]'::jsonb))='array' THEN COALESCE(${alias}.verification_evidence,'[]'::jsonb) ELSE '[]'::jsonb END)>0
    AND UPPER(COALESCE(${alias}.email_status,''))='VERIFIED'
    AND LOWER(COALESCE(${alias}.verification_status,''))='mailbox_verified'
    AND COALESCE(${alias}.relevance_status,'UNKNOWN') IN ('CURRENT','RECENT')
    AND COALESCE(${alias}.suppressed,FALSE)=FALSE`;
}

export const CANONICAL_MAILBOX_VERIFICATION_STATUS = VERIFIED_STATUS;
