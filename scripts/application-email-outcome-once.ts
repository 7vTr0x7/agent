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
import { JobDetailEnricher, validatePublicHttpUrl } from "../src/jobs/sources/JobDetailEnricher";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = new Database(config.databaseUrl);
  const events: Array<Record<string, unknown>> = [];
  try {
    await new MigrationRunner(database).run();
    const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!profile) throw new Error("Configured candidate profile could not be resolved.");

    const target = await database.query<{
      job_opportunity_id:string; company_name:string; title:string; canonical_url:string; company_domain:string|null; description:string;
      location:string|null; country:string|null; workplace_type:"onsite"|"remote"|"hybrid"|null; employment_type:string|null; posted_at:Date|null; updated_at:Date|null;
    }>(
      `SELECT jo.id AS job_opportunity_id, jo.company_name, jo.title, jo.canonical_url, jo.company_domain, jo.description,
              jo.location, jo.country, jo.workplace_type, jo.employment_type, jo.posted_at, jo.updated_at
       FROM job_opportunities jo
       JOIN match_decisions md ON md.job_opportunity_id=jo.id AND md.candidate_profile_id=$1
       WHERE md.decision='APPLY' AND jo.status='ACTIVE'
         AND jo.canonical_url IS NOT NULL AND jo.canonical_url <> ''
       ORDER BY md.match_score DESC, jo.posted_at DESC NULLS LAST
       LIMIT 1`,
      [profile.id]
    );
    const candidate = target.rows[0];
    if (!candidate) throw new Error("No ACTIVE APPLY job is available for application/email runtime.");

    let job = candidate;
    if (!job.company_domain) {
      const enricher = new JobDetailEnricher({ timeoutMs: 15_000, concurrency: 1, maxRedirects: 3 });
      const enriched = await enricher.enrich({
        source: "application-preflight",
        sourceJobId: job.job_opportunity_id,
        url: job.canonical_url,
        title: job.title,
        companyName: job.company_name,
        location: job.location,
        country: job.country,
        workplaceType: job.workplace_type,
        employmentType: job.employment_type,
        description: job.description,
        postedAt: job.posted_at,
        updatedAt: job.updated_at,
        contentHash: job.job_opportunity_id
      }, undefined, true);
      if (enriched.companyDomain) {
        await database.query(`UPDATE job_opportunities SET company_domain=$1, updated_at=NOW() WHERE id=$2`, [enriched.companyDomain, job.job_opportunity_id]);
        job = { ...job, company_domain: enriched.companyDomain };
        events.push({ event:"application-employer-domain-enriched", company:job.company_name, domain:enriched.companyDomain, sourceUrl:job.canonical_url, evidence:"job-detail" });
      }
    }
    if (!job.company_domain) {
      const companyPageEvidence = await resolveEmployerDomainFromPlatformCompanyPage(job.canonical_url, job.company_name);
      if (companyPageEvidence) {
        await database.query(`UPDATE job_opportunities SET company_domain=$1, updated_at=NOW() WHERE id=$2`, [companyPageEvidence.domain, job.job_opportunity_id]);
        job = { ...job, company_domain: companyPageEvidence.domain };
        events.push({ event:"application-employer-domain-enriched", company:job.company_name, domain:companyPageEvidence.domain, sourceUrl:companyPageEvidence.sourceUrl, evidence:"platform-company-page" });
      }
    }
    if (!job.company_domain) throw new Error("No ACTIVE APPLY job has validated employer-domain evidence after application preflight enrichment.");

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

async function resolveEmployerDomainFromPlatformCompanyPage(jobUrl: string, companyName: string): Promise<{domain:string;sourceUrl:string}|null> {
  let parsed: URL;
  try {
    parsed = new URL(jobUrl);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const companyIndex = segments.indexOf("companies");
  if (companyIndex < 0 || !segments[companyIndex + 1]) return null;
  const companySlug = segments[companyIndex + 1];
  const companyPageUrl = new URL(`/companies/${encodeURIComponent(companySlug)}`, `${parsed.protocol}//${parsed.host}`).toString();
  let validatedPageUrl: string;
  try {
    validatedPageUrl = await validatePublicHttpUrl(companyPageUrl);
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(validatedPageUrl, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; JobAgent/0.1; +https://github.com/7vTr0x7/agent)"
      }
    });
    if (!response.ok) return null;
    const html = await response.text();
    const companyTokens = companyName.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 3 && !["the","and","inc","ltd","llc","corp","company"].includes(token));
    if (!companyTokens.length) return null;
    for (const match of html.matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"'\s>]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const rawUrl = match[1];
      const anchorText = stripHtml(match[2] ?? "").toLowerCase();
      if (!rawUrl) continue;
      let candidate: URL;
      try { candidate = new URL(rawUrl); } catch { continue; }
      if (candidate.protocol !== "https:" && candidate.protocol !== "http:") continue;
      if (candidate.host.toLowerCase() === parsed.host.toLowerCase()) continue;
      const host = candidate.hostname.toLowerCase().replace(/^www\./, "");
      const labels = host.split(".").filter(Boolean);
      if (labels.length < 2 || host === "linkedin.com" || host.endsWith(".linkedin.com")) continue;
      const companyMatch = companyTokens.some(token => labels.slice(-3).some(label => label.includes(token)));
      if (!companyMatch) continue;
      return { domain:host, sourceUrl:validatedPageUrl };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

main().catch(error => { console.error(JSON.stringify({status:"FAILED", error:error instanceof Error ? error.message : String(error)}, null, 2)); process.exitCode=1; });