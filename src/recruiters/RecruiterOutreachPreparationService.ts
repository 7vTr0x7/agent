import { RecruiterContactCandidate } from "./RecruiterDiscovery";
import { RecruiterDiscoveryRepository, StoredRecruiterContact, RecruiterOutreachSequenceRecord, RecruiterOutreachMessageRecord } from "./RecruiterDiscoveryRepository";
import { evaluateRecruiterOutreachSafety } from "./RecruiterOutreachSafetyGate";

export type RecruiterApplicationOutcome = "SUBMITTED" | "FAILED" | "BLOCKED" | "NOT_ATTEMPTED";
export type RecruiterPreparationContact = StoredRecruiterContact & {
  verificationEvidence?: unknown[];
  mailboxEvidence?: boolean;
  emailStatus?: string;
  relevanceStatus?: "CURRENT" | "RECENT" | "HISTORICAL" | "UNKNOWN";
  relevanceEvidence?: unknown[];
  suppressed?: boolean;
};
export interface RecruiterOutreachPreparationInput {
  companyName:string; companyDomain:string; jobTitle:string; jobDescription:string; jobOpportunityId:string; applicationId?:string;
  candidateProfileId:string; candidateName:string; candidateSkills?:readonly string[]; candidateYearsExperience?:number; candidateLocation?:string; applicationOutcome?:RecruiterApplicationOutcome;
}
export interface PreparedRecruiterOutreach { contact:RecruiterPreparationContact; sequence:RecruiterOutreachSequenceRecord; message:RecruiterOutreachMessageRecord; }
export interface RecruiterOutreachPreparationOptions { repository:RecruiterDiscoveryRepository; minConfidence?:number; requireVerifiedEmail?:boolean; dryRun?:boolean; }

export class RecruiterOutreachPreparationService {
  private readonly minConfidence:number; private readonly requireVerifiedEmail:boolean; private readonly dryRun:boolean;
  constructor(private readonly options:RecruiterOutreachPreparationOptions){this.minConfidence=options.minConfidence??80;this.requireVerifiedEmail=options.requireVerifiedEmail??true;this.dryRun=options.dryRun??true;}
  async prepare(input:RecruiterOutreachPreparationInput,contacts:RecruiterPreparationContact[]):Promise<PreparedRecruiterOutreach[]>{
    if(!input.jobOpportunityId.trim())throw new Error("jobOpportunityId is required for recruiter outreach.");
    if(!input.candidateProfileId.trim())throw new Error("candidateProfileId is required for recruiter outreach.");
    const prepared:PreparedRecruiterOutreach[]=[];
    for(const contact of contacts){
      const suppressed=await this.options.repository.isSuppressed(contact.email,input.companyDomain);
      const duplicate=await this.options.repository.isOutreachSequenceDuplicate(contact.id,input.jobOpportunityId,input.candidateProfileId);
      const candidate:RecruiterContactCandidate={email:contact.email,fullName:contact.fullName,title:contact.title,department:contact.department,seniority:contact.seniority,country:contact.country,location:contact.location,confidence:contact.confidence,verified:contact.verified,verificationStatus:contact.verificationStatus,provider:contact.provider,verificationEvidence:contact.verificationEvidence,sources:[]};
      const safety=evaluateRecruiterOutreachSafety({
        companyName:input.companyName,companyDomain:input.companyDomain,contact:candidate,minConfidence:this.minConfidence,
        requireVerifiedEmail:this.requireVerifiedEmail,suppressedEmail:suppressed.email||contact.suppressed===true,suppressedDomain:suppressed.domain,
        duplicateSequence:duplicate,dryRun:this.dryRun,relevanceStatus:contact.relevanceStatus??"UNKNOWN"
      });
      if(!safety.allowed)continue;
      const sequence=await this.options.repository.createOutreachSequence({recruiterContactId:contact.id,jobOpportunityId:input.jobOpportunityId,applicationId:input.applicationId??null,candidateProfileId:input.candidateProfileId});
      if(!sequence)continue;
      const message=await this.options.repository.createOutreachMessage({sequenceId:sequence.id,messageType:"INITIAL",sequenceStep:0,recipientEmail:contact.email,subject:`Application for ${input.jobTitle} at ${input.companyName}`,body:buildInitialMessage(input,contact)});
      prepared.push({contact,sequence,message});
    }
    return prepared;
  }
}

function buildInitialMessage(input:RecruiterOutreachPreparationInput,contact:StoredRecruiterContact):string{
  const greeting=contact.fullName?`Hi ${contact.fullName.split(" ")[0]},`:"Hi,"; const role=input.jobTitle.trim(); const company=input.companyName.trim(); const candidate=input.candidateName.trim()||"Candidate";
  const outcome=input.applicationOutcome??"NOT_ATTEMPTED"; const jobText=`${role} ${input.jobDescription}`.toLowerCase(); const skills=[...new Set((input.candidateSkills??[]).map(skill=>skill.trim()).filter(Boolean))];
  const relevantSkills=skills.filter(skill=>jobText.includes(skill.toLowerCase())).slice(0,5); const skillList=(relevantSkills.length?relevantSkills:skills.slice(0,4)).join(", ");
  const experience=Number.isFinite(input.candidateYearsExperience)&&(input.candidateYearsExperience??0)>0?`${input.candidateYearsExperience} years of experience`:null; const location=input.candidateLocation?.trim()?input.candidateLocation.trim():null;
  const applicationLine=outcome==="SUBMITTED"?`I’ve applied for the role and wanted to reach out directly in case you’re involved in the hiring process.`:outcome==="FAILED"?`I attempted to apply for the role, but the application could not be completed successfully, so I wanted to reach out directly regarding the opportunity.`:outcome==="BLOCKED"?`I was unable to complete the application through the available application flow, so I wanted to reach out directly regarding the opportunity.`:`I’m reaching out directly regarding the opportunity in case you’re involved in the hiring process.`;
  const profileLine=[experience,skillList?`with experience in ${skillList}`:null].filter(Boolean).join(" "); const locationLine=location?`I’m currently based in ${location}.`:null;
  return[greeting,"",`I’m ${candidate}, and I’m interested in the ${role} opportunity at ${company}.`,profileLine?`My background includes ${profileLine}.`:null,locationLine,"",applicationLine,"I’d be happy to share my resume or any additional information that would be useful for the team.","","Thank you for your time.","",candidate].filter((line):line is string=>line!==null).join("\n");
}
