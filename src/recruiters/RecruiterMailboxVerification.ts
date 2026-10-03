export type CanonicalMailboxVerificationStatus = "VERIFIED" | "LIKELY" | "UNVERIFIED" | "INVALID";
export type CanonicalRecruiterRelevanceStatus = "CURRENT" | "RECENT" | "HISTORICAL" | "UNKNOWN";
export interface RecruiterMailboxVerificationEvidence { provider?: string | null; status?: string | null; confidence?: number | null; mailboxLevel?: boolean | null; source?: string | null; }
export interface RecruiterMailboxVerificationRecord { verified?: boolean | null; verificationStatus?: string | null; emailStatus?: string | null; mailboxEvidence?: boolean | null; verificationEvidence?: unknown[] | null; suppressed?: boolean | null; relevanceStatus?: string | null; email?: string | null; companyDomain?: string | null; provider?: string | null; }
const VERIFIED_STATUS = "mailbox_verified";
const PUBLIC_LIKELY_STATUS = "public-web-likely";
const LEGACY_UNSAFE_STATUSES = new Set(["verified_public_source","domain_mx_verified","domain_mx_verified_doh","unverified_public_source","verified_mailbox","verified","valid"]);
const AUTOMATED_MAILBOX_LOCAL_PARTS = new Set(["noreply","no-reply","donotreply","do-not-reply","mailer-daemon","mailer","notifications","notification","automated","bot"]);

export function isPlausibleMailboxAddress(email: string | null | undefined): boolean { const normalized=email?.trim().toLowerCase()??""; if(!normalized||normalized.length>254||normalized.includes("%")||/[\s"'<>()[\],;:]/.test(normalized))return false; const parts=normalized.split("@"); if(parts.length!==2)return false; const local=parts[0]??""; const domain=parts[1]??""; if(["example.com","example.org","example.net"].includes(domain))return false; if(!local||!domain||local.length>64||local.startsWith(".")||local.endsWith(".")||local.includes(".."))return false; if(domain.startsWith(".")||domain.endsWith(".")||domain.includes(".."))return false; if(!/^[a-z0-9!#$&'*+/=?^_`{|}~.-]+$/i.test(local))return false; if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))return false; return true; }
export function normalizeMailboxVerificationStatus(status: string | null | undefined): CanonicalMailboxVerificationStatus { const normalized=status?.trim().toLowerCase()??""; if(normalized===VERIFIED_STATUS)return"VERIFIED"; if(normalized===PUBLIC_LIKELY_STATUS||normalized==="likely"||normalized==="domain_mx_verified"||normalized==="domain_mx_verified_doh")return"LIKELY"; if(normalized==="invalid"||normalized==="invalid_email_format"||normalized==="no_mx_record"||normalized==="missing_email_domain"||normalized==="not_valid")return"INVALID"; return"UNVERIFIED"; }
export function hasExplicitMailboxEvidence(evidence: unknown[] | null | undefined): boolean { if(!Array.isArray(evidence)||evidence.length===0)return false; return evidence.some((item):item is RecruiterMailboxVerificationEvidence=>{if(!item||typeof item!=="object")return false;const candidate=item as RecruiterMailboxVerificationEvidence;return candidate.mailboxLevel===true&&typeof candidate.provider==="string"&&candidate.provider.trim().length>0&&typeof candidate.status==="string"&&candidate.status.trim().length>0;}); }
export function hasExplicitPublicEmailEvidence(evidence: unknown[] | null | undefined): boolean { if(!Array.isArray(evidence)||evidence.length===0)return false; return evidence.some((item):item is RecruiterMailboxVerificationEvidence=>{if(!item||typeof item!=="object")return false;const candidate=item as RecruiterMailboxVerificationEvidence;return candidate.mailboxLevel===false&&typeof candidate.provider==="string"&&candidate.provider.trim().length>0&&typeof candidate.status==="string"&&candidate.status.trim().length>0&&typeof candidate.source==="string"&&candidate.source.trim().length>0;}); }
function isAutomatedMailbox(email: string | null | undefined): boolean { const local=email?.trim().toLowerCase().split("@")[0]??""; return AUTOMATED_MAILBOX_LOCAL_PARTS.has(local); }
export function isMailboxVerifiedForRealSend(record: RecruiterMailboxVerificationRecord): boolean { const status=String(record.verificationStatus??"").trim().toLowerCase(); const emailStatus=String(record.emailStatus??"").trim().toUpperCase(); return record.verified===true&&record.mailboxEvidence===true&&hasExplicitMailboxEvidence(record.verificationEvidence)&&emailStatus==="VERIFIED"&&status===VERIFIED_STATUS&&!LEGACY_UNSAFE_STATUSES.has(status)&&isRecruiterRelevantForRealSend(record)&&record.suppressed!==true; }
export function isPubliclyLikelyForRealSend(record: RecruiterMailboxVerificationRecord): boolean {
  const status=String(record.verificationStatus??"").trim().toLowerCase();
  const emailStatus=String(record.emailStatus??"").trim().toUpperCase();
  if(record.verified===true||record.mailboxEvidence===true||emailStatus!=="LIKELY"||status!==PUBLIC_LIKELY_STATUS||!hasExplicitPublicEmailEvidence(record.verificationEvidence)||record.suppressed===true)return false;
  if(record.provider!==undefined&&record.provider!==null&&record.provider!=="proactive-public-web")return false;
  if(record.email!==undefined||record.companyDomain!==undefined){ const email=record.email?.trim().toLowerCase()??""; const domain=record.companyDomain?.trim().toLowerCase().replace(/^www\./,"")??""; if(!isPlausibleMailboxAddress(email)||!domain||email.split("@")[1]!==domain)return false; }
  return true;
}
/**
 * A real company-domain address can be used for outreach without mailbox-level
 * verification. This deliberately accepts generic company mailboxes such as
 * contact@company.com and info@company.com, while excluding automated/no-reply
 * destinations. Gmail is never used to prove that the recipient mailbox exists.
 */
export function isPublicCompanyDomainEmailForRealSend(record: RecruiterMailboxVerificationRecord): boolean {
  const email=record.email?.trim().toLowerCase()??"";
  const companyDomain=record.companyDomain?.trim().toLowerCase().replace(/^www\./,"")??"";
  const emailDomain=email.split("@")[1]??"";
  const relevance=String(record.relevanceStatus??"UNKNOWN").trim().toUpperCase();
  const emailStatus=String(record.emailStatus??"").trim().toUpperCase();
  if(record.suppressed===true||record.verified===true||record.mailboxEvidence===true)return false;
  if(!isPlausibleMailboxAddress(email)||!companyDomain||emailDomain!==companyDomain)return false;
  if(emailStatus!=="UNVERIFIED"&&emailStatus!=="LIKELY")return false;
  if(isAutomatedMailbox(email))return false;
  return true;
}
export function isRecruiterRelevantForRealSend(_record: RecruiterMailboxVerificationRecord): boolean { return true; }
export function isEligibleForRealRecruiterSend(record: RecruiterMailboxVerificationRecord): boolean { return isMailboxVerifiedForRealSend(record)||isPubliclyLikelyForRealSend(record)||isPublicCompanyDomainEmailForRealSend(record); }
export function recruiterRealSendEligibilitySql(alias="c"):string{const emailSql=`(SELECT canonical_contact.email FROM contacts canonical_contact WHERE canonical_contact.id=${alias}.contact_id)`;return `(
    (
      COALESCE(${alias}.verified,FALSE)=TRUE
      AND COALESCE(${alias}.mailbox_evidence,FALSE)=TRUE
      AND jsonb_typeof(COALESCE(${alias}.verification_evidence,'[]'::jsonb))='array'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(COALESCE(${alias}.verification_evidence,'[]'::jsonb))='array' THEN COALESCE(${alias}.verification_evidence,'[]'::jsonb) ELSE '[]'::jsonb END) AS evidence(item) WHERE COALESCE(evidence.item->>'mailboxLevel','false')='true' AND NULLIF(BTRIM(evidence.item->>'provider'),'') IS NOT NULL AND NULLIF(BTRIM(evidence.item->>'status'),'') IS NOT NULL)
      AND UPPER(COALESCE(${alias}.email_status,''))='VERIFIED'
      AND LOWER(COALESCE(${alias}.verification_status,''))='mailbox_verified'
    )
    OR
    (
      COALESCE(${alias}.provider,'')='proactive-public-web'
      AND COALESCE(${alias}.verified,FALSE)=FALSE
      AND COALESCE(${alias}.mailbox_evidence,FALSE)=FALSE
      AND UPPER(COALESCE(${alias}.email_status,''))='LIKELY'
      AND LOWER(COALESCE(${alias}.verification_status,''))='public-web-likely'
      AND jsonb_typeof(COALESCE(${alias}.verification_evidence,'[]'::jsonb))='array'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(COALESCE(${alias}.verification_evidence,'[]'::jsonb))='array' THEN COALESCE(${alias}.verification_evidence,'[]'::jsonb) ELSE '[]'::jsonb END) AS evidence(item) WHERE COALESCE(evidence.item->>'mailboxLevel','true')='false' AND NULLIF(BTRIM(evidence.item->>'provider'),'') IS NOT NULL AND NULLIF(BTRIM(evidence.item->>'status'),'') IS NOT NULL AND NULLIF(BTRIM(evidence.item->>'source'),'') IS NOT NULL)
    )
    OR
    (
      COALESCE(${alias}.verified,FALSE)=FALSE
      AND COALESCE(${alias}.mailbox_evidence,FALSE)=FALSE
      AND UPPER(COALESCE(${alias}.email_status,'')) IN ('UNVERIFIED','LIKELY')
      AND ${emailSql} IS NOT NULL
      AND ${emailSql} ~* '^[A-Za-z0-9!#$&''*+/=?^_\\x60{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
      AND SPLIT_PART(${emailSql},'@',1) !~* '(^\\.|\\.$|\\.\\.|%|^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|mailer|notifications?|automated|bot)$)'
      AND SPLIT_PART(${emailSql},'@',2) !~* '(^\\.|\\.$|\\.\\.)'
      AND LOWER(SPLIT_PART(${emailSql},'@',2))=LOWER(${alias}.company_domain)
    )
    AND COALESCE(${alias}.suppressed,FALSE)=FALSE
    AND ${emailSql} IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM recruiter_suppressions suppression WHERE LOWER(COALESCE(suppression.email,''))=LOWER(${emailSql}) OR LOWER(COALESCE(suppression.company_domain,''))=LOWER(${alias}.company_domain))
  )`;}
export const CANONICAL_MAILBOX_VERIFICATION_STATUS=VERIFIED_STATUS;
export const PUBLIC_LIKELY_MAILBOX_STATUS=PUBLIC_LIKELY_STATUS;
