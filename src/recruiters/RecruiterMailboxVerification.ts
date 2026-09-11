export type CanonicalMailboxVerificationStatus = "VERIFIED" | "LIKELY" | "UNVERIFIED" | "INVALID";
export type CanonicalRecruiterRelevanceStatus = "CURRENT" | "RECENT" | "HISTORICAL" | "UNKNOWN";

export interface RecruiterMailboxVerificationEvidence { provider?: string | null; status?: string | null; confidence?: number | null; mailboxLevel?: boolean | null; source?: string | null; }
export interface RecruiterMailboxVerificationRecord { verified?: boolean | null; verificationStatus?: string | null; emailStatus?: string | null; mailboxEvidence?: boolean | null; verificationEvidence?: unknown[] | null; suppressed?: boolean | null; relevanceStatus?: string | null; }
const VERIFIED_STATUS = "mailbox_verified";
const LEGACY_UNSAFE_STATUSES = new Set(["verified_public_source","domain_mx_verified","domain_mx_verified_doh","unverified_public_source","verified_mailbox","verified","valid"]);
export function normalizeMailboxVerificationStatus(status: string | null | undefined): CanonicalMailboxVerificationStatus { const normalized=status?.trim().toLowerCase()??""; if(normalized===VERIFIED_STATUS)return"VERIFIED"; if(normalized==="likely"||normalized==="domain_mx_verified"||normalized==="domain_mx_verified_doh")return"LIKELY"; if(normalized==="invalid"||normalized==="invalid_email_format"||normalized==="no_mx_record"||normalized==="missing_email_domain"||normalized==="not_valid")return"INVALID"; return"UNVERIFIED"; }
export function hasExplicitMailboxEvidence(evidence: unknown[] | null | undefined): boolean { if(!Array.isArray(evidence)||evidence.length===0)return false; return evidence.some((item):item is RecruiterMailboxVerificationEvidence=>{if(!item||typeof item!=="object")return false;const candidate=item as RecruiterMailboxVerificationEvidence;return candidate.mailboxLevel===true&&typeof candidate.provider==="string"&&candidate.provider.trim().length>0&&typeof candidate.status==="string"&&candidate.status.trim().length>0;}); }
export function isMailboxVerifiedForRealSend(record: RecruiterMailboxVerificationRecord): boolean { const status=String(record.verificationStatus??"").trim().toLowerCase(); return record.verified===true&&record.mailboxEvidence===true&&hasExplicitMailboxEvidence(record.verificationEvidence)&&String(record.emailStatus??"").toUpperCase()==="VERIFIED"&&status===VERIFIED_STATUS&&!LEGACY_UNSAFE_STATUSES.has(status); }
export function isRecruiterRelevantForRealSend(record: RecruiterMailboxVerificationRecord): boolean { const relevance=String(record.relevanceStatus??"UNKNOWN").trim().toUpperCase(); return relevance==="CURRENT"||relevance==="RECENT"; }
export function isEligibleForRealRecruiterSend(record: RecruiterMailboxVerificationRecord): boolean { return isMailboxVerifiedForRealSend(record)&&isRecruiterRelevantForRealSend(record)&&record.suppressed!==true; }
export function recruiterRealSendEligibilitySql(alias="c"):string{return `COALESCE(${alias}.verified,FALSE)=TRUE
    AND COALESCE(${alias}.mailbox_evidence,FALSE)=TRUE
    AND jsonb_typeof(COALESCE(${alias}.verification_evidence,'[]'::jsonb))='array'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(COALESCE(${alias}.verification_evidence,'[]'::jsonb))='array' THEN COALESCE(${alias}.verification_evidence,'[]'::jsonb) ELSE '[]'::jsonb END) AS evidence(item) WHERE COALESCE(evidence.item->>'mailboxLevel','false')='true' AND NULLIF(BTRIM(evidence.item->>'provider'),'') IS NOT NULL AND NULLIF(BTRIM(evidence.item->>'status'),'') IS NOT NULL)
    AND UPPER(COALESCE(${alias}.email_status,''))='VERIFIED'
    AND LOWER(COALESCE(${alias}.verification_status,''))='mailbox_verified'
    AND UPPER(COALESCE(${alias}.relevance_status,'UNKNOWN')) IN ('CURRENT','RECENT')
    AND COALESCE(${alias}.suppressed,FALSE)=FALSE
    AND ${alias}.email ~* '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
    AND LOWER(SPLIT_PART(${alias}.email,'@',2))=LOWER(${alias}.company_domain)
    AND NOT EXISTS (SELECT 1 FROM recruiter_suppressions suppression WHERE LOWER(COALESCE(suppression.email,''))=LOWER(${alias}.email) OR LOWER(COALESCE(suppression.company_domain,''))=LOWER(${alias}.company_domain))`;}
export const CANONICAL_MAILBOX_VERIFICATION_STATUS=VERIFIED_STATUS;
