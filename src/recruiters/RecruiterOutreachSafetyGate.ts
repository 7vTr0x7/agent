import { PERMANENTLY_EXCLUDED_COMPANIES } from "../applications/ApplicationPolicy";
import { RecruiterContactCandidate } from "./RecruiterDiscovery";
import { isBlockedEmployerDomain } from "./RecruiterCompanyDomainResolver";
import { hasExplicitMailboxEvidence, isEligibleForRealRecruiterSend } from "./RecruiterMailboxVerification";

export interface RecruiterOutreachSafetyInput {
  companyName: string;
  companyDomain: string;
  contact: RecruiterContactCandidate;
  minConfidence: number;
  requireVerifiedEmail: boolean;
  suppressedEmail: boolean;
  suppressedDomain: boolean;
  duplicateSequence: boolean;
  dryRun: boolean;
  relevanceStatus?: "CURRENT" | "RECENT" | "HISTORICAL" | "UNKNOWN";
}
export interface RecruiterOutreachSafetyResult { allowed:boolean; reason:string; }
function normalize(value:string):string{return value.trim().toLowerCase();}

export function evaluateRecruiterOutreachSafety(input:RecruiterOutreachSafetyInput):RecruiterOutreachSafetyResult{
  const excluded=PERMANENTLY_EXCLUDED_COMPANIES.some((company)=>normalize(company)===normalize(input.companyName));
  if(excluded)return{allowed:false,reason:"Company is permanently excluded from outreach."};
  const companyDomain=normalize(input.companyDomain).replace(/^www\./,"");
  if(isBlockedEmployerDomain(companyDomain))return{allowed:false,reason:"Company domain is a job board, ATS, aggregator, or otherwise not an employer domain."};
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contact.email))return{allowed:false,reason:"Contact email has an invalid format."};
  const emailDomain=normalize(input.contact.email.split("@").pop()??"");
  if(!emailDomain||emailDomain!==companyDomain)return{allowed:false,reason:"Contact email is not on the employer domain."};
  if(input.contact.email.includes("+")||/example\.(com|org|net)$/i.test(emailDomain))return{allowed:false,reason:"Contact email appears synthetic or unsuitable for outreach."};
  const explicitMailboxEvidence=hasExplicitMailboxEvidence(input.contact.verificationEvidence??[]);
  const canonicalEligible=isEligibleForRealRecruiterSend({
    verified:input.contact.verified,
    verificationStatus:input.contact.verificationStatus,
    emailStatus:input.contact.verified?"VERIFIED":"UNVERIFIED",
    mailboxEvidence:explicitMailboxEvidence,
    verificationEvidence:input.contact.verificationEvidence??[],
    relevanceStatus:input.relevanceStatus??"UNKNOWN",
    suppressed:input.suppressedEmail||input.suppressedDomain
  });
  if(input.requireVerifiedEmail&&!canonicalEligible)return{allowed:false,reason:"Contact does not satisfy the canonical recruiter mailbox eligibility contract."};
  if(typeof input.contact.confidence==="number"&&input.contact.confidence<input.minConfidence)return{allowed:false,reason:`Contact confidence ${input.contact.confidence} is below the configured minimum.`};
  if(input.suppressedEmail||input.suppressedDomain)return{allowed:false,reason:"Contact or company is suppressed from outreach."};
  if(input.duplicateSequence)return{allowed:false,reason:"An active or completed outreach sequence already exists for this contact and job."};
  if(input.dryRun)return{allowed:true,reason:"Dry-run safety gate passed; no email may be sent."};
  return{allowed:true,reason:"Outreach safety gate passed."};
}
