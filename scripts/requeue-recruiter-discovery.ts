import "dotenv/config";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { RecruiterDiscoveryTaskDispatcher } from "../src/recruiters/RecruiterDiscoveryTask";
import { resolveEmployerDomainFromJobData, resolveEmployerDomainFromPublicSearch } from "../src/recruiters/RecruiterCompanyDomainResolver";
import { PERMANENTLY_EXCLUDED_COMPANIES } from "../src/applications/ApplicationPolicy";
import { TaskQueue } from "../src/queue/TaskQueue";

interface JobRow { id:string; company_name:string; company_domain:string|null; canonical_url:string; title:string; description:string; location:string|null; }
function excluded(companyName:string):boolean { const normalized=companyName.trim().toLowerCase(); return PERMANENTLY_EXCLUDED_COMPANIES.some((company)=>company.trim().toLowerCase()===normalized); }
function companyKey(companyName:string):string { return companyName.trim().toLowerCase(); }
function configuredConcurrency():number { const value=Number.parseInt(process.env.RECRUITER_DOMAIN_RESOLUTION_CONCURRENCY??"6",10); return Number.isFinite(value)&&value>0?Math.min(value,12):6; }

async function resolvePublicDomains(companies:string[], concurrency:number):Promise<Map<string,string|null>> {
  const resolved=new Map<string,string|null>();
  let nextIndex=0;
  let completed=0;
  const worker=async():Promise<void>=>{ while(true){ const index=nextIndex++; if(index>=companies.length) return; const company=companies[index]; const domain=await resolveEmployerDomainFromPublicSearch(company); resolved.set(companyKey(company),domain); completed++; if(completed%10===0||completed===companies.length) console.log(`[requeue-recruiter-discovery] resolved employer domains ${completed}/${companies.length}`); } };
  await Promise.all(Array.from({length:Math.min(concurrency,Math.max(companies.length,1))},()=>worker()));
  return resolved;
}

async function main():Promise<void>{
  const config=loadConfig();
  if(!config.recruiterOutreach.enabled) throw new Error("Recruiter outreach is disabled in the current environment.");
  const database=new Database(config.databaseUrl);
  try{
    await new MigrationRunner(database).run();
    const profiles=ConfiguredCandidateProfileResolver.fromEnvironment();
    const candidateProfileId=process.env.CANDIDATE_PROFILE_ID??"";
    const candidateProfile=await profiles.getById(candidateProfileId);
    if(!candidateProfile) throw new Error("Configured candidate profile could not be resolved.");
    const requestedLimit=Number.parseInt(process.env.RECRUITER_REQUEUE_LIMIT??"500",10);
    const limit=Number.isFinite(requestedLimit)&&requestedLimit>0?requestedLimit:500;
    const result=await database.query<JobRow>(`SELECT jo.id,jo.company_name,jo.company_domain,jo.canonical_url,jo.title,jo.description,jo.location
      FROM job_opportunities jo JOIN match_decisions md ON md.job_opportunity_id=jo.id AND md.candidate_profile_id=$1 AND md.decision IN ('APPLY','REVIEW')
      WHERE jo.status='ACTIVE' ORDER BY jo.updated_at DESC LIMIT $2`,[candidateProfileId,limit]);

    const publicSearchCompanies=new Set<string>();
    for(const job of result.rows){
      if(excluded(job.company_name)) continue;
      if(!resolveEmployerDomainFromJobData(job.company_domain,job.canonical_url,job.description)) publicSearchCompanies.add(companyKey(job.company_name));
    }
    const companyNames=new Map<string,string>();
    for(const job of result.rows) if(!excluded(job.company_name)) companyNames.set(companyKey(job.company_name),job.company_name.trim());
    const companies=[...publicSearchCompanies].map((key)=>companyNames.get(key)).filter((name):name is string=>Boolean(name));
    const concurrency=configuredConcurrency();
    console.log(`[requeue-recruiter-discovery] inspecting ${result.rows.length} jobs; ${companies.length} unique companies need public employer resolution (concurrency=${concurrency})`);
    const publicDomains=await resolvePublicDomains(companies,concurrency);

    const queue=new TaskQueue(database); const dispatcher=new RecruiterDiscoveryTaskDispatcher(queue);
    let queued=0, skippedExcluded=0, skippedNoDomain=0, resolvedByPublicSearch=0;
    for(const job of result.rows){
      if(excluded(job.company_name)){skippedExcluded++;continue;}
      let companyDomain=resolveEmployerDomainFromJobData(job.company_domain,job.canonical_url,job.description);
      if(!companyDomain){
        companyDomain=publicDomains.get(companyKey(job.company_name))??null;
        if(companyDomain) resolvedByPublicSearch++;
      }
      if(!companyDomain){skippedNoDomain++;continue;}
      await dispatcher.enqueue({companyName:job.company_name,companyDomain,jobTitle:job.title,jobDescription:job.description,location:job.location??undefined,candidateProfileId,candidateName:candidateProfile.fullName??([candidateProfile.firstName,candidateProfile.lastName].filter(Boolean).join(" ")||"Candidate"),jobOpportunityId:job.id,applicationOutcome:"NOT_ATTEMPTED"},40);
      queued++;
    }
    console.log(JSON.stringify({status:"QUEUED",inspected:result.rows.length,queued,resolvedByPublicSearch,uniqueCompanies:companies.length,skippedExcluded,skippedNoDomain,domainResolutionConcurrency:concurrency,eligibility:"MATCH_DECISION_APPLY_OR_REVIEW",dedupeVersion:"v4-parallel-public-employer-resolution"},null,2));
  }finally{await database.close();}
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.stack??error.message:String(error));process.exitCode=1;});
