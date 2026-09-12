import { Database } from "../src/database/Database";
import { PostgresJobOpportunityRepository } from "../src/jobs/domain/PostgresJobOpportunityRepository";
import { createCanonicalJobId, createJobContentFingerprint, canonicalizeJobUrl } from "../src/jobs/domain/JobCanonicalization";
import { RecruiterDiscoveryRepository } from "../src/recruiters/RecruiterDiscoveryRepository";
import { RecruiterOutreachPreparationService } from "../src/recruiters/RecruiterOutreachPreparationService";

const requiredSafeFlags = ["GMAIL_ENABLED", "OUTBOUND_ENABLED", "PROACTIVE_RECRUITER_SEND_ENABLED"] as const;
const jobUrl = "https://phase7.example/jobs/frontend-engineer-react?utm_source=fixture&utm_campaign=phase7";
const canonicalUrl = canonicalizeJobUrl(jobUrl);
const canonicalId = createCanonicalJobId(jobUrl);
const jobId = "70000000-0000-4000-8000-000000000001";
const candidateProfileId = "phase7-fixture-candidate";
const companyName = "Phase Seven Fixture Co";
const companyDomain = "phase7fixture.test";
const recruiterEmail = "alex.recruiter@phase7fixture.test";
const recruiterId = "71000000-0000-4000-8000-000000000001";

async function main(): Promise<void> {
  for (const flag of requiredSafeFlags) if ((process.env[flag] ?? "false").trim().toLowerCase() !== "false") throw new Error(`Unsafe Phase 7 fixture configuration: ${flag} must be false.`);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

  const db = new Database(process.env.DATABASE_URL);
  try {
    const jobs = new PostgresJobOpportunityRepository(db);
    const recruiters = new RecruiterDiscoveryRepository(db);
    const now = new Date();
    const description = "Build React and TypeScript applications for the web platform.";
    const opportunity = await jobs.save({ id: jobId, canonicalId, canonicalUrl, title: "Frontend Engineer", companyName, companyDomain, location: "Bengaluru, India", country: "India", workplaceType: "onsite", employmentType: "Full-time", description, postedAt: now, sourceUpdatedAt: now, lastSeenAt: now, closedAt: null, status: "ACTIVE", createdAt: now, updatedAt: now });
    if (opportunity.id !== jobId || opportunity.canonicalUrl !== canonicalUrl) throw new Error("Job normalization/persistence assertion failed.");
    const duplicate = await jobs.findByCanonicalId(canonicalId);
    if (!duplicate || duplicate.id !== jobId) throw new Error("Job canonical deduplication assertion failed.");

    await db.query(`INSERT INTO match_decisions (job_opportunity_id,candidate_profile_id,decision,match_score,matched_skills,missing_skills,evidence,reason,evaluator,model,input_hash) VALUES ($1,$2,'APPLY',94,$3::jsonb,$4::jsonb,$5::jsonb,$6,'phase7-fixture',NULL,$7) ON CONFLICT (job_opportunity_id,candidate_profile_id) DO UPDATE SET decision='APPLY',match_score=94,matched_skills=EXCLUDED.matched_skills,missing_skills=EXCLUDED.missing_skills,evidence=EXCLUDED.evidence,reason=EXCLUDED.reason,updated_at=NOW()`, [jobId,candidateProfileId,JSON.stringify(["React","TypeScript"]),JSON.stringify([]),JSON.stringify(["title=Frontend Engineer","location=Bengaluru, India","freshness=current"]),"React and TypeScript match the candidate profile.",createJobContentFingerprint({title:opportunity.title,companyName:opportunity.companyName,location:opportunity.location,description:opportunity.description})]);

    const evidence=[{provider:"phase7-fixture-mailbox-verifier",status:"mailbox_verified",confidence:99,mailboxLevel:true,source:"isolated-test-provider"}];
    const recruiter=await recruiters.upsertContact(companyName,companyDomain,{email:recruiterEmail,fullName:"Alex Recruiter",title:"Technical Recruiter",department:"Talent Acquisition",seniority:"Senior",confidence:98,verified:true,verificationStatus:"mailbox_verified",verificationEvidence:evidence,provider:"phase7-fixture-mailbox-verifier",sources:[{url:canonicalUrl,type:"current_job_posting",confidence:99}]});
    if (recruiter.id !== recruiterId) await db.query(`UPDATE recruiter_contacts SET id=$2 WHERE id=$1`,[recruiter.id,recruiterId]);
    const canonicalRecruiterId = recruiterId;
    await recruiters.addSources(canonicalRecruiterId,{email:recruiterEmail,fullName:"Alex Recruiter",title:"Technical Recruiter",department:"Talent Acquisition",seniority:"Senior",confidence:98,verified:true,verificationStatus:"mailbox_verified",verificationEvidence:evidence,provider:"phase7-fixture-mailbox-verifier",sources:[{url:canonicalUrl,type:"current_job_posting",confidence:99}]});
    await db.query(`UPDATE recruiter_contacts SET id=$1 WHERE email=$2 AND company_domain=$3`,[canonicalRecruiterId,recruiterEmail,companyDomain]);
    await db.query(`UPDATE recruiter_contact_sources SET recruiter_contact_id=$1 WHERE recruiter_contact_id IN (SELECT id FROM recruiter_contacts WHERE email=$2 AND company_domain=$3)`,[canonicalRecruiterId,recruiterEmail,companyDomain]);

    const row=await db.query<any>(`SELECT id,company_name,company_domain,email,full_name,title,department,seniority,country,location,confidence,verified,verification_status,provider,email_status,mailbox_evidence,verification_evidence,relevance_status,relevance_evidence,suppressed FROM recruiter_contacts WHERE id=$1`,[canonicalRecruiterId]);
    const c=row.rows[0]; if(!c)throw new Error("Recruiter fixture persistence assertion failed.");
    const contact={id:c.id,companyName:c.company_name,companyDomain:c.company_domain,email:c.email,fullName:c.full_name,title:c.title,department:c.department,seniority:c.seniority,country:c.country,location:c.location,confidence:c.confidence,verified:c.verified,verificationStatus:c.verification_status,provider:c.provider,emailStatus:c.email_status,mailboxEvidence:c.mailbox_evidence,verificationEvidence:Array.isArray(c.verification_evidence)?c.verification_evidence:[],relevanceStatus:c.relevance_status,relevanceEvidence:Array.isArray(c.relevance_evidence)?c.relevance_evidence:[],suppressed:c.suppressed};
    if(c.verified!==true||c.email_status!=="VERIFIED"||c.verification_status!=="mailbox_verified"||c.mailbox_evidence!==true||c.relevance_status!=="CURRENT")throw new Error(`Positive canonical recruiter assertion failed: ${JSON.stringify({verified:c.verified,emailStatus:c.email_status,verificationStatus:c.verification_status,mailboxEvidence:c.mailbox_evidence,relevanceStatus:c.relevance_status})}`);

    const service=new RecruiterOutreachPreparationService({repository:recruiters,requireVerifiedEmail:true,dryRun:true});
    const payload={companyName,companyDomain,jobTitle:opportunity.title,jobDescription:opportunity.description,jobOpportunityId:jobId,candidateProfileId,candidateName:"Phase Seven Candidate",candidateSkills:["React","Next.js","TypeScript"],candidateYearsExperience:3,candidateLocation:"Pune",applicationOutcome:"NOT_ATTEMPTED" as const};
    const first=await service.prepare(payload,[contact]);
    const second=await service.prepare(payload,[contact]);
    if(first.length!==1)throw new Error(`Expected exactly one prepared outreach, got ${first.length}.`);
    if(second.length!==0)throw new Error(`Expected idempotent second preparation to produce zero new messages, got ${second.length}.`);
    if(first[0]?.message.status!=="PREPARED")throw new Error("Prepared outreach did not remain PREPARED.");
    if(!first[0]?.message.body.includes("Frontend Engineer")||!first[0]?.message.body.includes("Phase Seven Fixture Co")||!first[0]?.message.body.includes("React"))throw new Error("Personalization did not include job/company/skill context.");

    const counts=await db.query<{sequences:string;messages:string;sent:string}>(`SELECT (SELECT COUNT(*) FROM recruiter_outreach_sequences WHERE recruiter_contact_id=$1 AND job_opportunity_id=$2 AND candidate_profile_id=$3) sequences,(SELECT COUNT(*) FROM recruiter_outreach_messages m JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id WHERE s.recruiter_contact_id=$1 AND s.job_opportunity_id=$2) messages,(SELECT COUNT(*) FROM recruiter_outreach_messages m JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id WHERE s.recruiter_contact_id=$1 AND s.job_opportunity_id=$2 AND m.status='SENT') sent`,[canonicalRecruiterId,jobId,candidateProfileId]);
    const state=counts.rows[0]; if(!state||state.sequences!=="1"||state.messages!=="1"||state.sent!=="0")throw new Error(`Outreach idempotency/safety assertion failed: ${JSON.stringify(state)}`);
    console.log(JSON.stringify({status:"ok",job:{persisted:true,canonicalId,canonicalUrl},match:{decision:"APPLY",score:94},recruiter:{persisted:true,relevance:c.relevance_status,verified:c.verified,mailboxEvidence:c.mailbox_evidence},outreach:{prepared:first.length,sequences:state?.sequences,messages:state?.messages,sent:state?.sent},sendEnabled:false,gmailEnabled:false,outboundEnabled:false,snovCreditsUsed:0,productionDatabase:false}));
  } finally { await db.close(); }
}

main().catch((error)=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
