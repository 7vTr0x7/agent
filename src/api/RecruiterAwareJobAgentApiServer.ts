import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { Database } from "../database/Database";
import { recruiterRealSendEligibilitySql } from "../recruiters/RecruiterMailboxVerification";
import { JobAgentApiServer, JobAgentApiServerOptions } from "./JobAgentApiServer";

export class RecruiterAwareJobAgentApiServer {
  private server: Server | null = null;
  private readonly delegate: JobAgentApiServer;

  constructor(private readonly database: Database, private readonly options: JobAgentApiServerOptions = {}) {
    this.delegate = new JobAgentApiServer(database, options);
  }

  async start(): Promise<void> {
    if (this.server) return;
    const host = this.options.host ?? process.env.API_HOST ?? "127.0.0.1";
    const port = this.options.port ?? Number(process.env.API_PORT ?? 3000);
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ status: "ERROR", error: "Internal server error" }));
        }
        console.error("Job Agent API request failed:", error instanceof Error ? error.message : String(error));
      });
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => { server.off("listening", onListening); reject(error); };
      const onListening = (): void => { server.off("error", onError); resolve(); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.delegate.closeRealtimeEvents();
    if (!server) return;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  getAddress(): { host: string; port: number } | null {
    const address = this.server?.address();
    if (!address || typeof address === "string") return null;
    return { host: address.address, port: address.port };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://job-agent.local");
    if (request.method === "GET" && url.pathname === "/api/events") {
      await this.delegate.handleRealtimeEvents(response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/summary") {
      await this.handleSummary(response);
      return;
    }
    const delegate = (this.delegate as unknown as { handle: (request: IncomingMessage, response: ServerResponse) => Promise<void> }).handle.bind(this.delegate);
    await delegate(request, response);
  }

  private async handleSummary(response: ServerResponse): Promise<void> {
    const eligibility = recruiterRealSendEligibilitySql("c");
    const result = await this.database.query(`
      WITH latest_matches AS (
        SELECT DISTINCT ON (job_opportunity_id) job_opportunity_id,decision,match_score,reason,created_at
        FROM match_decisions ORDER BY job_opportunity_id,created_at DESC
      )
      SELECT
        (SELECT COUNT(*)::text FROM job_opportunities) AS jobs,
        (SELECT COUNT(*)::text FROM latest_matches) AS matches,
        (SELECT COUNT(*)::text FROM applications) AS applications,
        (SELECT COUNT(*)::text FROM recruiter_contacts) AS recruiters,
        (SELECT COUNT(*)::text FROM public_contact_resource_contacts WHERE validation_status <> 'INVALID' AND relevance_score > 0) AS contacts,
        (SELECT COUNT(*)::text FROM recruiter_contact_sources WHERE LOWER(COALESCE(source_type,'')) IN ('public_profile','public_contact_resource','public_recruiter_profile')) AS content,
        (SELECT COUNT(*)::text FROM recruiter_outreach_messages WHERE status='SENT') AS "outreachSent",
        (SELECT COUNT(*)::text FROM tasks WHERE status IN ('PENDING','RUNNING')) AS "pendingTasks",
        (SELECT COUNT(*)::text FROM latest_matches WHERE decision='APPLY') AS "matchApply",
        (SELECT COUNT(*)::text FROM latest_matches WHERE decision='REVIEW') AS "matchReview",
        (SELECT COUNT(*)::text FROM latest_matches WHERE decision='REJECT') AS "matchReject",
        (SELECT COUNT(*)::text FROM recruiter_contacts WHERE verified=true AND email_status='VERIFIED' AND mailbox_evidence=true) AS "verifiedRecruiterEmails",
        (SELECT COUNT(*)::text FROM recruiter_contacts c WHERE ${eligibility}) AS "eligibleRecruiterEmails",
        (SELECT COUNT(*)::text FROM recruiter_contacts WHERE relevance_status='CURRENT') AS "currentRecruiters",
        (SELECT COUNT(*)::text FROM recruiter_contacts WHERE relevance_status='RECENT') AS "recentRecruiters",
        (SELECT COALESCE(jsonb_agg(x ORDER BY x.score DESC,x.posted_at DESC NULLS LAST),'[]'::jsonb) FROM (
          SELECT j.company_name AS company,j.title AS role,j.location,j.canonical_url AS url,m.decision,m.match_score AS score,m.reason,j.posted_at
          FROM latest_matches m JOIN job_opportunities j ON j.id=m.job_opportunity_id
          ORDER BY m.match_score DESC,j.posted_at DESC NULLS LAST LIMIT 10
        ) x) AS "topMatches",
        (SELECT COALESCE(jsonb_agg(x ORDER BY x."relevanceScore" DESC NULLS LAST,x.confidence DESC NULLS LAST,x.updated_at DESC),'[]'::jsonb) FROM (
          SELECT c.full_name AS name,c.company_name AS company,c.title AS role,c.relevance_status AS relevance,c.relevance_score AS "relevanceScore",
                 (SELECT s.source_url FROM recruiter_contact_sources s WHERE s.recruiter_contact_id=c.id AND NULLIF(TRIM(s.source_url),'') IS NOT NULL ORDER BY s.observed_at DESC LIMIT 1) AS "profileUrl",
                 (SELECT s.source_type FROM recruiter_contact_sources s WHERE s.recruiter_contact_id=c.id AND NULLIF(TRIM(s.source_url),'') IS NOT NULL ORDER BY s.observed_at DESC LIMIT 1) AS "sourceType",
                 c.email,c.email_status AS "emailStatus",c.verified,c.mailbox_evidence AS "mailboxEvidence",c.confidence,
                 (${eligibility}) AS "eligibleForOutreach",c.updated_at
          FROM recruiter_contacts c
          WHERE COALESCE(c.suppressed,FALSE)=FALSE
            AND (
              c.relevance_status IN ('CURRENT','RECENT','UNKNOWN')
              OR c.email IS NOT NULL
              OR EXISTS (
                SELECT 1 FROM contacts canonical_contact
                WHERE canonical_contact.id=c.contact_id AND NULLIF(TRIM(canonical_contact.email),'') IS NOT NULL
              )
            )
            AND EXISTS (
              SELECT 1 FROM recruiter_contact_sources s
              WHERE s.recruiter_contact_id=c.id
                AND NULLIF(TRIM(s.source_url),'') IS NOT NULL
                AND LOWER(COALESCE(s.source_type,'')) NOT IN ('job_hiring_evidence','current_job_posting','recent_job_posting','current_role','recent_role')
            )
          ORDER BY c.relevance_score DESC NULLS LAST,c.confidence DESC NULLS LAST,c.updated_at DESC LIMIT 10
        ) x) AS "recruiterLeads"
    `);
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(result.rows[0] ?? {}));
  }
}
