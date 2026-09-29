import { PERMANENTLY_EXCLUDED_COMPANIES } from "../applications/ApplicationPolicy";
import { RecruiterContactCandidate } from "./RecruiterDiscovery";
import { isBlockedEmployerDomain } from "./RecruiterCompanyDomainResolver";
import { hasExplicitMailboxEvidence, isEligibleForRealRecruiterSend, isRecruiterRelevantForRealSend } from "./RecruiterMailboxVerification";
export interface RecruiterOutreachSafetyInput{companyName:string;companyDomain:string;contact:RecruiterContactCandidate;minConfidence:number;requireVerifiedEmail:boolean;suppressedEmail:boolean;suppressedDomain:boolean;duplicateSequence:boolean;dryRun:boolean;relevanceStatus?:"CURRENT"|"RECENT"|"HISTORICAL"|"UNKNOWN"}
export interface RecruiterOutreachSafetyResult{allowed:boolean;reason:string}
const normalize=(value:string):string=>value.trim().toLowerCase();
export function evaluateRecruiterOutreachSafety(input:RecruiterOutreachSafetyInput):RecruiterOutreachSafetyResult{
  const excluded=PERMANENTLY_EXCLUDED_COMPANIES.some(company=>normalize(company)===normalize(input.companyName));
  if(excluded)return{allowed:false,reason:"Company is permanently excluded from outreach."};
  const companyDomain=normalize(input.companyDomain).replace(/^www\./,"");
  if(isBlockedEmployerDomain(companyDomain))return{allowed:false,reason:"Company domain is a job board, ATS, aggregator, or otherwise not an employer domain."};
  if(!/^[A-Za-z0-9!#$&'*+/=?^_`{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(input.contact.email))return{allowed:false,reason:"Contact email has an invalid format."};
  const emailDomain=normalize(input.contact.email.split("@").pop()??"");
  if(!emailDomain||emailDomain!==companyDomain)return{allowed:false,reason:"Contact email is not on the employer domain."};
  if(input.contact.email.includes("+")||/example\.(com|org|net)$/i.test(emailDomain))return{allowed:false,reason:"Contact email appears synthetic or unsuitable for outreach."};
  const evidence=input.contact.verificationEvidence??[];
  const canonicalEligible=isEligibleForRealRecruiterSend({
    verified:input.contact.verified,
    verificationStatus:input.contact.verificationStatus,
    emailStatus:input.contact.verified?"VERIFIED":String(input.contact.verificationStatus??"").toLowerCase()==="public-web-likely"?"LIKELY":"UNVERIFIED",
    mailboxEvidence:hasExplicitMailboxEvidence(evidence),
    verificationEvidence:evidence,
    relevanceStatus:input.relevanceStatus??"UNKNOWN",
    suppressed:input.suppressedEmail||input.suppressedDomain,
    email:input.contact.email,
    companyDomain,
    provider:input.contact.provider,
  });
  if(input.requireVerifiedEmail&&!canonicalEligible)return{allowed:false,reason:"Contact does not satisfy the canonical verified or evidence-backed public recruiter email contract."};
  if(input.requireVerifiedEmail&&input.relevanceStatus!==undefined&&!isRecruiterRelevantForRealSend({relevanceStatus:input.relevanceStatus}))return{allowed:false,reason:"Recruiter evidence is not current or recent for outreach."};
  if(typeof input.contact.confidence==="number"&&input.contact.confidence<input.minConfidence)return{allowed:false,reason:`Contact confidence ${input.contact.confidence} is below the configured minimum.`};
  if(input.suppressedEmail||input.suppressedDomain)return{allowed:false,reason:"Contact or company is suppressed from outreach."};
  if(input.duplicateSequence)return{allowed:false,reason:"An active or completed outreach sequence already exists for this contact and job."};
  if(input.dryRun)return{allowed:true,reason:"Dry-run safety gate passed; no email may be sent."};
  return{allowed:true,reason:"Outreach safety gate passed."};
}
