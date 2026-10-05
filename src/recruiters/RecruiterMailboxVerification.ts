export type CanonicalMailboxVerificationStatus = "VERIFIED" | "LIKELY" | "UNVERIFIED" | "INVALID";
export type CanonicalRecruiterRelevanceStatus = "CURRENT" | "RECENT" | "HISTORICAL" | "UNKNOWN";
export interface RecruiterMailboxVerificationEvidence { provider?: string | null; status?: string | null; confidence?: number | null; mailboxLevel?: boolean | null; source?: string | null; }
export interface RecruiterMailboxVerificationRecord { verified?: boolean | null; verificationStatus?: string | null; emailStatus?: string | null; mailboxEvidence?: boolean | null; verificationEvidence?: unknown[] | null; suppressed?: boolean | null; relevanceStatus?: string | null; email?: string | null; companyDomain?: string | null; companyName?: string | null; provider?: string | null; }
const VERIFIED_STATUS = "mailbox_verified";
const PUBLIC_LIKELY_STATUS = "public-web-likely";
const LEGACY_UNSAFE_STATUSES = new Set(["verified_public_source","domain_mx_verified","domain_mx_verified_doh","unverified_public_source","verified_mailbox","verified","valid"]);
const AUTOMATED_MAILBOX_LOCAL_PARTS = new Set(["noreply","no-reply","donotreply","do-not-reply","mailer-daemon","mailer","notifications","notification","automated","bot"]);
const NON_RECRUITER_LOCAL_PARTS = new Set(["pay","payments","payroll","billing","accounts-payable","accounts-receivable","candidateprotection","candidate-protection","accommodation","accommodations","accessibility","claims","benefits"]);
const NON_RECRUITER_LOCAL_PATTERNS = [/^u?\d+[a-z]*hiringaccommodation$/i, /(?:^|[-_])hiring[-_]?accommodation(?:$|[-_])/i];
const GENERIC_EMAIL_DOMAINS = new Set(["gmail.com","googlemail.com","outlook.com","hotmail.com","live.com","yahoo.com","yahoo.co.in","icloud.com","proton.me","protonmail.com"]);
const PERMANENTLY_EXCLUDED_COMPANY_NAMES = new Set(["octopus technologies","sketch brahma technologies"]);
const NON_EMAIL_RESOURCE_TLDS = new Set(["png","jpg","jpeg","gif","webp","svg","ico","bmp","tif","tiff","avif","heic","pdf","doc","docx","xls","xlsx","csv","txt","zip","rar","7z","tar","gz","json","xml","html","htm"]);

export function isPlausibleMailboxAddress(email: string | null | undefined): boolean { const normalized=email?.trim().toLowerCase()??""; if(!normalized||normalized.length>254||normalized.includes("%")||/[\s"'<>()[\],;:]/.test(normalized))return false; const parts=normalized.split("@"); if(parts.length!==2)return false; const local=parts[0]??""; const domain=parts[1]??""; if(["example.com","example.org","example.net"].includes(domain))return false; if(!local||!domain||local.length>64||local.startsWith(".")||local.endsWith(".")||local.includes(".."))return false; if(domain.startsWith(".")||domain.endsWith(".")||domain.includes(".."))return false; if(NON_EMAIL_RESOURCE_TLDS.has(domain.split(".").at(-1)??""))return false; if(!/^[a-z0-9!#$&'*+/=?^_`{|}~.-]+$/i.test(local))return false; if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))return false; return true; }
export function normalizeMailboxVerificationStatus(status: string | null | undefined): CanonicalMailboxVerificationStatus { const normalized=status?.trim().toLowerCase()??""; if(normalized===VERIFIED_STATUS)return"VERIFIED"; if(normalized===PUBLIC_LIKELY_STATUS||normalized==="likely"||normalized==="domain_mx_verified"||normalized==="domain_mx_verified_doh")return"LIKELY"; if(normalized==="invalid"||normalized==="invalid_email_format"||normalized==="no_mx_record"||normalized==="missing_email_domain"||normalized==="not_valid")return"INVALID"; return"UNVERIFIED"; }
export function hasExplicitMailboxEvidence(evidence: unknown[] | null | undefined): boolean { if(!Array.isArray(evidence)||evidence.length===0)return false; return evidence.some((item):item is RecruiterMailboxVerificationEvidence=>{if(!item||typeof item!=="object")return false;const candidate=item as RecruiterMailboxVerificationEvidence;return candidate.mailboxLevel===true&&typeof candidate.provider==="string"&&candidate.provider.trim().length>0&&typeof candidate.status==="string"&&candidate.status.trim().length>0;}); }
export function hasExplicitPublicEmailEvidence(evidence: unknown[] | null | undefined): boolean { if(!Array.isArray(evidence)||evidence.length===0)return false; return evidence.some((item):item is RecruiterMailboxVerificationEvidence=>{if(!item||typeof item!=="object")return false;const candidate=item as RecruiterMailboxVerificationEvidence;return candidate.mailboxLevel===false&&typeof candidate.provider==="string"&&candidate.provider.trim().length>0&&typeof candidate.status==="string"&&candidate.status.trim().length>0&&typeof candidate.source==="string"&&candidate.source.trim().length>0;}); }
function isAutomatedMailbox(email: string | null | undefined): boolean { const local=email?.trim().toLowerCase().split("@")[0]??""; return AUTOMATED_MAILBOX_LOCAL_PARTS.has(local); }
export function isNonRecruiterMailbox(email: string | null | undefined): boolean { const local=email?.trim().toLowerCase().split("@")[0]??""; return NON_RECRUITER_LOCAL_PARTS.has(local)||NON_RECRUITER_LOCAL_PATTERNS.some((pattern)=>pattern.test(local)); }
export function isRecruiterOutreachAddress(email: string | null | undefined): boolean { return isPlausibleMailboxAddress(email) && !isAutomatedMailbox(email) && !isNonRecruiterMailbox(email); }
export function isPermanentlyExcludedRecruiterCompany(companyName: string | null | undefined): boolean { return PERMANENTLY_EXCLUDED_COMPANY_NAMES.has(companyName?.trim().toLowerCase() ?? ""); }
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
export function isEligibleForRealRecruiterSend(record: RecruiterMailboxVerificationRecord): boolean {
  const email = record.email?.trim().toLowerCase() ?? "";
  const emailStatus = String(record.emailStatus ?? "").trim().toUpperCase();
  const companyDomain = record.companyDomain?.trim().toLowerCase().replace(/^www\\./, "") ?? "";
  const emailDomain = email.split("@")[1] ?? "";
  if (record.suppressed === true) return false;
  if (isPermanentlyExcludedRecruiterCompany(record.companyName)) return false;
  if (!isRecruiterOutreachAddress(email)) return false;
  if (companyDomain && !GENERIC_EMAIL_DOMAINS.has(emailDomain) && emailDomain !== companyDomain) return false;
  return emailStatus === "UNVERIFIED" || emailStatus === "LIKELY" || emailStatus === "VERIFIED";
}
export function isSimplePublicRecruiterContactForRealSend(record: RecruiterMailboxVerificationRecord): boolean {
  const email=record.email?.trim().toLowerCase()??"";
  const emailStatus=String(record.emailStatus??"").trim().toUpperCase();
  if(record.suppressed===true) return false;
  if(!isPlausibleMailboxAddress(email)||emailStatus==="INVALID"||isAutomatedMailbox(email)) return false;
  return emailStatus==="UNVERIFIED"||emailStatus==="LIKELY"||emailStatus==="VERIFIED";
}

export function recruiterRealSendEligibilitySql(alias="c"):string {
  const emailSql=`(SELECT canonical_contact.email FROM contacts canonical_contact WHERE canonical_contact.id=${alias}.contact_id)`;
  return `(
    COALESCE(${alias}.suppressed,FALSE)=FALSE
    AND LOWER(TRIM(COALESCE(${alias}.company_name,''))) NOT IN ('octopus technologies','sketch brahma technologies')
    AND ${emailSql} IS NOT NULL
    AND ${emailSql} ~* '^[A-Za-z0-9!#$&''*+/=?^_\\x60{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
    AND LOWER(SUBSTRING(SPLIT_PART(${emailSql},'@',2) FROM '[^.]+$')) NOT IN ('png','jpg','jpeg','gif','webp','svg','ico','bmp','tif','tiff','avif','heic','pdf','doc','docx','xls','xlsx','csv','txt','zip','rar','7z','tar','gz','json','xml','html','htm')
    AND SPLIT_PART(${emailSql},'@',1) !~* '(^\\.|\\.$|\\.\\.|%|^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|mailer|notifications?|automated|bot|pay|payments|payroll|billing|accounts-payable|accounts-receivable|candidateprotection|candidate-protection|accommodation|accommodations|accessibility|claims|benefits)$|(^|[-_])hiring[-_]?accommodation($|[-_]))'
    AND UPPER(COALESCE(${alias}.email_status,'')) IN ('UNVERIFIED','LIKELY','VERIFIED')
    AND (
      LOWER(SPLIT_PART(${emailSql},'@',2))=LOWER(COALESCE(${alias}.company_domain,''))
      OR LOWER(SPLIT_PART(${emailSql},'@',2)) IN ('gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','yahoo.co.in','icloud.com','proton.me','protonmail.com')
      OR NULLIF(BTRIM(COALESCE(${alias}.company_domain,'')),'') IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM recruiter_suppressions suppression
      WHERE LOWER(COALESCE(suppression.email,''))=LOWER(${emailSql})
         OR LOWER(COALESCE(suppression.company_domain,''))=LOWER(COALESCE(${alias}.company_domain,''))
    )
  )`;
}

export function recruiterSimplePublicContactEligibilitySql(alias="c"):string{
  const emailSql=`(SELECT canonical_contact.email FROM contacts canonical_contact WHERE canonical_contact.id=${alias}.contact_id)`;
  return `(
    COALESCE(${alias}.suppressed,FALSE)=FALSE
    AND LOWER(TRIM(COALESCE(${alias}.company_name,''))) NOT IN ('octopus technologies','sketch brahma technologies')
    AND ${emailSql} IS NOT NULL
    AND ${emailSql} ~* '^[A-Za-z0-9!#$&''*+/=?^_\\x60{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
    AND LOWER(SUBSTRING(SPLIT_PART(${emailSql},'@',2) FROM '[^.]+$')) NOT IN ('png','jpg','jpeg','gif','webp','svg','ico','bmp','tif','tiff','avif','heic','pdf','doc','docx','xls','xlsx','csv','txt','zip','rar','7z','tar','gz','json','xml','html','htm')
    AND SPLIT_PART(${emailSql},'@',1) !~* '(^\\.|\\.$|\\.\\.|%|^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|mailer|notifications?|automated|bot|pay|payments|payroll|billing|accounts-payable|accounts-receivable|candidateprotection|candidate-protection|accommodation|accommodations|accessibility|claims|benefits)$|(^|[-_])hiring[-_]?accommodation($|[-_]))'
    AND UPPER(COALESCE(${alias}.email_status,'')) IN ('UNVERIFIED','LIKELY','VERIFIED')
    AND NOT EXISTS (
      SELECT 1 FROM recruiter_suppressions suppression
      WHERE LOWER(COALESCE(suppression.email,''))=LOWER(${emailSql})
         OR LOWER(COALESCE(suppression.company_domain,''))=LOWER(COALESCE(${alias}.company_domain,''))
    )
  )`;
}

export const CANONICAL_MAILBOX_VERIFICATION_STATUS=VERIFIED_STATUS;
export const PUBLIC_LIKELY_MAILBOX_STATUS=PUBLIC_LIKELY_STATUS;
