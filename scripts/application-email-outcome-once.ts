import "dotenv/config";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { TaskQueue } from "../src/queue/TaskQueue";
import { APPLY_JOB_TASK } from "../src/applications/ApplicationTask";
import { ApplicationTaskHandler } from "../src/applications/ApplicationTaskHandler";
import { ApplicationRepository } from "../src/applications/ApplicationRepository";
import { ApplicationSubmissionService } from "../src/applications/ApplicationSubmissionService";
import { BrowserSessionService } from "../src/applications/BrowserSession";
import { ApplicationAdapterRegistry } from "../src/applications/ApplicationAdapter";
import { createHostedAtsApplicationAdapters } from "../src/applications/AtsApplicationAdapters";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = new Database(config.databaseUrl);
  const events: Array<Record<string, unknown>> = [];
  try {
    await new MigrationRunner(database).run();
    const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!profile) throw new Error("Configured candidate profile could not be resolved.");

    const target = await database.query<{
      job_opportunity_id:string; company_name:string; title:string; canonical_url:string; company_domain:string|null;
    }>(
      `SELECT jo.id AS job_opportunity_id, jo.company_name, jo.title, jo.canonical_url, jo.company_domain
       FROM job_opportunities jo
       JOIN match_decisions md ON md.job_opportunity_id=jo.id AND md.candidate_profile_id=$1
       WHERE md.decision='APPLY' AND jo.status='ACTIVE' AND jo.company_domain IS NOT NULL
         AND jo.company_domain <> '' AND jo.canonical_url IS NOT NULL AND jo.canonical_url <> ''
       ORDER BY md.match_score DESC, jo.posted_at DESC NULLS LAST
       LIMIT 1`,
      [profile.id]
    );
    const job = target.rows[0];
    if (!job) throw new Error("No ACTIVE APPLY job with a validated employer domain is available for application/email runtime.");

    const queue = new TaskQueue(database);
    const taskId = await queue.enqueue({
      taskType: APPLY_JOB_TASK,
      payload: { jobOpportunityId: job.job_opportunity_id, candidateProfileId: profile.id },
      priority: 100,
      dedupeKey: `fast-application-email:${job.job_opportunity_id}:${profile.id}`
    });
    const workerId = `fast-application-email-${process.pid}`;
    const claimed = await queue.claim<{ jobOpportunityId: string; candidateProfileId: string }>(workerId, [APPLY_JOB_TASK]);
    if (!claimed || claimed.id !== taskId) throw new Error("Could not claim the application runtime task.");

    const applications = new ApplicationRepository(database, (process.env.JOB_EXCLUDED_COMPANIES ?? "").split(",").map(v => v.trim()).filter(Boolean));
    const browser = new BrowserSessionService({ headless: true, navigationTimeoutMs: 30000 });
    const adapters = new ApplicationAdapterRegistry(createHostedAtsApplicationAdapters());
    const submissions = new ApplicationSubmissionService(browser, adapters, applications, undefined, undefined, undefined, undefined, undefined, undefined, true);
    let emailDiscoveryStarted = false;
    let emailDiscoveryFinished = false;
    let discoveredEmails: Array<{email?:string;fullName?:string;title?:string}> = [];
    const emailDiscovery = {
      async discover(input: {companyName:string;companyDomain:string;jobTitle:string;jobDescription:string;candidateProfileId:string}) {
        emailDiscoveryStarted = true;
        events.push({ event:"application-email-discovery-start", company:input.companyName, domain:input.companyDomain, jobTitle:input.jobTitle });
        const { JobPostingRecruiterDiscoveryProvider } = await import("../src/recruiters/JobPostingRecruiterDiscoveryProvider");
        const result = await new JobPostingRecruiterDiscoveryProvider().discover(input);
        discoveredEmails = result.contacts.map(contact => ({ email:contact.email, fullName:contact.fullName, title:contact.title }));
        emailDiscoveryFinished = true;
        events.push({ event:"application-email-discovery-result", contacts:discoveredEmails.length, contactsWithEmail:discoveredEmails.filter(c => Boolean(c.email)).length });
        return discoveredEmails;
      }
    };
    const preparedEmails: Array<Record<string, unknown>> = [];
    const emailDispatcher = {
      async enqueueApplicationSubmitted(context: any) { preparedEmails.push({ state:"PREPARED_SUBMITTED", ...context }); return `prepared-submitted:${context.applicationId}`; },
      async enqueueApplicationBlocked(context: any) { preparedEmails.push({ state:"PREPARED_BLOCKED", ...context }); return `prepared-blocked:${context.applicationId}`; }
    };
    const handler = new ApplicationTaskHandler(
      applications,
      submissions,
      ConfiguredCandidateProfileResolver.fromEnvironment(),
      (process.env.JOB_EXCLUDED_COMPANIES ?? "").split(",").map(v => v.trim()).filter(Boolean),
      emailDispatcher,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      emailDiscovery
    );

    events.push({ event:"application-branch-start", jobUrl:job.canonical_url, company:job.company_name, title:job.title, jobOpportunityId:job.job_opportunity_id });
    let handlerError: string | null = null;
    try {
      await handler.handle(claimed);
    } catch (error) {
      handlerError = error instanceof Error ? error.message : String(error);
    }
    const applicationRow = await database.query<{status:string; id:string}>(
      `SELECT id,status FROM applications WHERE job_opportunity_id=$1 AND candidate_profile_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [job.job_opportunity_id, profile.id]
    );
    if (handlerError) await queue.fail(claimed.id, workerId, handlerError);
    else await queue.succeed(claimed.id, workerId);

    console.log(JSON.stringify({
      status:"ok",
      feature:"JOB_FIRST_APPLICATION_EMAIL",
      independentEmailBranch:true,
      sendEnabled:false,
      gmailEnabled:false,
      outboundEnabled:false,
      target:{jobOpportunityId:job.job_opportunity_id, company:job.company_name, title:job.title, jobUrl:job.canonical_url, companyDomain:job.company_domain},
      application:{handlerInvoked:true, taskId:claimed.id, taskStatus:handlerError ? "FAILED" : "SUCCEEDED", outcome:applicationRow.rows[0]?.status ?? null, error:handlerError},
      emailDiscovery:{started:emailDiscoveryStarted, finished:emailDiscoveryFinished, contacts:discoveredEmails.length, contactsWithEmail:discoveredEmails.filter(c => Boolean(c.email)).length, results:discoveredEmails.slice(0,10)},
      preparedEmail:preparedEmails[0] ?? null,
      events
    }, null, 2));
  } finally {
    await database.close();
  }
}
main().catch(error => { console.error(JSON.stringify({status:"FAILED", error:error instanceof Error ? error.message : String(error)}, null, 2)); process.exitCode=1; });
