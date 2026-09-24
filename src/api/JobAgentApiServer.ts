import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import { AddressInfo } from "node:net";
import { Database } from "../database/Database";

interface SummaryRow {
  jobs: string;
  matches: string;
  applications: string;
  recruiters: string;
  outreachSent: string;
  pendingTasks: string;
  matchApply: string;
  matchReview: string;
  matchReject: string;
  verifiedRecruiterEmails: string;
  currentRecruiters: string;
  recentRecruiters: string;
  topMatches: Array<{
    company: string;
    role: string;
    location: string | null;
    url: string;
    decision: "APPLY" | "REVIEW" | "REJECT";
    score: number;
    reason: string;
  }>;
  recruiterLeads: Array<{
    name: string | null;
    company: string;
    role: string | null;
    relevance: string;
    relevanceScore: number | null;
    hiringEvidence: unknown;
    profileUrl: string | null;
    email: string;
    emailStatus: string | null;
    verified: boolean;
    mailboxEvidence: boolean;
    confidence: number | null;
    eligibleForOutreach: boolean;
  }>;
}

export interface JobAgentApiServerOptions {
  host?: string;
  port?: number;
}

export class JobAgentApiServer {
  private server: Server | null = null;

  constructor(
    private readonly database: Database,
    private readonly options: JobAgentApiServerOptions = {}
  ) {}

  async start(): Promise<void> {
    if (this.server) return;
    const host = this.options.host ?? process.env.API_HOST ?? "127.0.0.1";
    const port = this.options.port ?? Number(process.env.API_PORT ?? 3000);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("API_PORT must be a valid TCP port.");

    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        writeJson(response, 500, { status: "ERROR", error: "Internal server error" });
        console.error("Job Agent API request failed:", error instanceof Error ? error.message : String(error));
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });

    this.server = server;
  }

  getAddress(): { host: string; port: number } | null {
    const address = this.server?.address();
    if (!address || typeof address === "string") return null;
    const info = address as AddressInfo;
    return { host: info.address, port: info.port };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://job-agent.local");
    response.setHeader("cache-control", "no-store");

    if (method !== "GET") {
      response.setHeader("allow", "GET");
      writeJson(response, 405, { status: "METHOD_NOT_ALLOWED" });
      return;
    }

    if (url.pathname === "/healthz") {
      try {
        await this.database.query("SELECT 1");
        writeJson(response, 200, { status: "ok", database: "ok" });
      } catch {
        writeJson(response, 503, { status: "degraded", database: "unavailable" });
      }
      return;
    }

    if (url.pathname === "/api/jobs") {
      const limit = parseLimit(url.searchParams.get("limit"));
      const decision = url.searchParams.get("decision");
      const params: unknown[] = [limit];
      const decisionClause = decision && ["APPLY", "REVIEW", "REJECT"].includes(decision)
        ? "WHERE m.decision = $2"
        : "";
      if (decisionClause) params.push(decision);
      const jobs = await this.database.query(`
        SELECT
          j.id,
          j.company_name AS company,
          j.title AS role,
          j.location,
          j.canonical_url AS url,
          j.posted_at,
          m.decision,
          m.match_score AS score,
          m.reason
        FROM job_opportunities j
        LEFT JOIN LATERAL (
          SELECT decision, match_score, reason
          FROM match_decisions
          WHERE job_opportunity_id=j.id
          ORDER BY created_at DESC
          LIMIT 1
        ) m ON true
        ${decisionClause}
        ORDER BY j.posted_at DESC NULLS LAST, j.created_at DESC
        LIMIT $1
      `, params);
      writeJson(response, 200, { jobs: jobs.rows });
      return;
    }

    if (url.pathname === "/api/applications") {
      const limit = parseLimit(url.searchParams.get("limit"));
      const applications = await this.database.query(`
        SELECT
          a.id,
          j.company_name AS company,
          j.title AS role,
          j.location,
          j.canonical_url AS url,
          m.match_score AS score,
          m.reason
        FROM applications a
        JOIN job_opportunities j ON j.id=a.job_opportunity_id
        LEFT JOIN LATERAL (
          SELECT match_score, reason
          FROM match_decisions
          WHERE job_opportunity_id=j.id
          ORDER BY created_at DESC
          LIMIT 1
        ) m ON true
        ORDER BY a.created_at DESC
        LIMIT $1
      `, [limit]);
      writeJson(response, 200, { applications: applications.rows });
      return;
    }

    if (url.pathname === "/api/summary") {
      const summary = await this.database.query<SummaryRow>(`
        SELECT
          (SELECT COUNT(*)::text FROM job_opportunities) AS jobs,
          (SELECT COUNT(*)::text FROM match_decisions) AS matches,
          (SELECT COUNT(*)::text FROM applications) AS applications,
          (SELECT COUNT(*)::text FROM recruiter_contacts) AS recruiters,
          (SELECT COUNT(*)::text FROM recruiter_outreach_messages WHERE status='SENT') AS "outreachSent",
          (SELECT COUNT(*)::text FROM tasks WHERE status IN ('PENDING','RUNNING')) AS "pendingTasks",
          (SELECT COUNT(*)::text FROM match_decisions WHERE decision='APPLY') AS "matchApply",
          (SELECT COUNT(*)::text FROM match_decisions WHERE decision='REVIEW') AS "matchReview",
          (SELECT COUNT(*)::text FROM match_decisions WHERE decision='REJECT') AS "matchReject",
          (SELECT COUNT(*)::text FROM recruiter_contacts WHERE verified=true AND email_status='VERIFIED' AND mailbox_evidence=true) AS "verifiedRecruiterEmails",
          (SELECT COUNT(*)::text FROM recruiter_contacts WHERE relevance_status='CURRENT') AS "currentRecruiters",
          (SELECT COUNT(*)::text FROM recruiter_contacts WHERE relevance_status='RECENT') AS "recentRecruiters",
          (
            SELECT COALESCE(jsonb_agg(x ORDER BY x.score DESC, x.posted_at DESC NULLS LAST), '[]'::jsonb)
            FROM (
              SELECT
                j.company_name AS company,
                j.title AS role,
                j.location,
                j.canonical_url AS url,
                m.decision,
                m.match_score AS score,
                m.reason,
                j.posted_at
              FROM match_decisions m
              JOIN job_opportunities j ON j.id=m.job_opportunity_id
              ORDER BY m.match_score DESC, j.posted_at DESC NULLS LAST
              LIMIT 10
            ) x
          ) AS "topMatches",
          (
            SELECT COALESCE(jsonb_agg(x ORDER BY x."relevanceScore" DESC NULLS LAST, x.confidence DESC NULLS LAST, x.updated_at DESC), '[]'::jsonb)
            FROM (
              SELECT
                c.full_name AS name,
                c.company_name AS company,
                c.title AS role,
                c.relevance_status AS relevance,
                c.relevance_score AS "relevanceScore",
                c.relevance_evidence AS "hiringEvidence",
                (
                  SELECT s.source_url
                  FROM recruiter_contact_sources s
                  WHERE s.recruiter_contact_id=c.id
                  ORDER BY s.observed_at DESC
                  LIMIT 1
                ) AS "profileUrl",
                c.email,
                c.email_status AS "emailStatus",
                c.verified,
                c.mailbox_evidence AS "mailboxEvidence",
                c.confidence,
                (
                  c.verified=true
                  AND c.email_status='VERIFIED'
                  AND c.mailbox_evidence=true
                  AND c.relevance_status IN ('CURRENT','RECENT')
                  AND COALESCE(c.suppressed,false)=false
                  AND COALESCE(c.confidence,0) >= 80
                ) AS "eligibleForOutreach",
                c.updated_at
              FROM recruiter_contacts c
              WHERE c.relevance_status IN ('CURRENT','RECENT')
              ORDER BY c.relevance_score DESC NULLS LAST, c.confidence DESC NULLS LAST, c.updated_at DESC
              LIMIT 10
            ) x
          ) AS "recruiterLeads"
      `);
      writeJson(response, 200, summary.rows[0] ?? {});
      return;
    }

    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(DASHBOARD_HTML);
      return;
    }

    writeJson(response, 404, { status: "NOT_FOUND" });
  }
}

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? 25);
  if (!Number.isInteger(parsed) || parsed < 1) return 25;
  return Math.min(parsed, 100);
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job Agent</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;padding:32px;background:#f6f7f9;color:#17202a}
main{max-width:1100px;margin:auto}h1{margin-bottom:4px}.muted{color:#667085}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-top:24px}
.card,.section{background:white;border:1px solid #e4e7ec;border-radius:12px;padding:16px}
.value{font-size:28px;font-weight:700;margin-top:6px}.status{margin-top:24px;padding:12px;border-radius:8px;background:white;border:1px solid #e4e7ec}
.section{margin-top:24px}.result{padding:14px 0;border-bottom:1px solid #eaecf0}.result:last-child{border-bottom:0}
.result h3{margin:0 0 6px}.meta{margin:3px 0}.reason{margin-top:8px}.pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#eef2f6;margin-right:6px;font-size:12px}
a{color:inherit}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.toolbar button{border:1px solid #d0d5dd;background:white;border-radius:8px;padding:7px 10px;cursor:pointer}.toolbar button.active{font-weight:700}
</style>
</head>
<body><main>
<h1>Job Agent</h1>
<div class="muted">Live operational dashboard — read-only results</div>
<div id="status" class="status">Loading…</div>
<div id="grid" class="grid"></div>
<section class="section"><h2>Top Matches</h2><div class="toolbar"><button data-filter="APPLY">Match</button><button data-filter="REVIEW">Review</button><button data-filter="REJECT">Skip</button><button data-filter="ALL" class="active">All</button></div><div id="matches">Loading…</div></section>
<section class="section"><h2>Application Queue</h2><div id="applications">Loading…</div></section>
<section class="section"><h2>Recruiter Leads</h2><div id="recruiters">Loading…</div></section>
</main>
<script>
function esc(value){return String(value??'').replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
function decisionLabel(value){return value==='APPLY'?'MATCH':value==='REVIEW'?'REVIEW':'SKIP'}
function renderMatches(items){
  if(!items.length)return '<div class="muted">No match records yet.</div>';
  return items.map(function(x){return '<article class="result"><h3>'+esc(x.role)+' — '+esc(x.company)+'</h3><div class="meta">'+esc(x.location||'Location unknown')+'</div><div class="meta"><span class="pill">'+esc(decisionLabel(x.decision))+'</span><span class="pill">Score '+esc(x.score)+'</span></div><div class="meta"><a href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">'+esc(x.url)+'</a></div><div class="reason">'+esc(x.reason)+'</div></article>';}).join('');
}
function renderApplications(items){
  if(!items.length)return '<div class="muted">No application candidates yet.</div>';
  return items.map(function(x){return '<article class="result"><h3>'+esc(x.role)+' — '+esc(x.company)+'</h3><div class="meta">'+esc(x.location||'Location unknown')+' · score '+esc(x.score??'unknown')+'</div><div class="meta"><a href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">Open application/job</a></div><div class="reason">'+esc(x.reason||'No match explanation available.')+'</div></article>';}).join('');
}
function renderRecruiters(items){
  if(!items.length)return '<div class="muted">No current/recent recruiter leads yet.</div>';
  return items.map(function(x){return '<article class="result"><h3>'+esc(x.name||'Recruiter identity unavailable')+' — '+esc(x.company)+'</h3><div class="meta">'+esc(x.role||'Recruiter role unavailable')+' · '+esc(x.relevance)+' relevance</div><div class="meta">Email: '+esc(x.email)+' · '+esc(x.emailStatus||'UNKNOWN')+(x.eligibleForOutreach?' · ELIGIBLE':'')+'</div><div class="meta">Confidence: '+esc(x.confidence??'unknown')+' · Mailbox evidence: '+(x.mailboxEvidence?'yes':'no')+'</div>'+(x.profileUrl?'<div class="meta"><a href="'+esc(x.profileUrl)+'" target="_blank" rel="noopener noreferrer">Source evidence</a></div>':'')+'</article>';}).join('');
}
let latestSummary=null;
async function refresh(){
  try{
    const health=await fetch('/healthz'); const response=await fetch('/api/summary'); latestSummary=await response.json();
    document.getElementById('status').textContent=health.ok?'Database connected':'Database unavailable';
    const data=latestSummary;
    const cards={'JOBS DISCOVERED':data.jobs,'MATCH':data.matchApply,'REVIEW':data.matchReview,'SKIP':data.matchReject,'RECRUITERS':data.recruiters,'VERIFIED EMAILS':data.verifiedRecruiterEmails,'CURRENT RECRUITERS':data.currentRecruiters,'RECENT RECRUITERS':data.recentRecruiters,'EMAILS SENT':data.outreachSent,'APPLICATIONS':data.applications};
    document.getElementById('grid').innerHTML=Object.entries(cards).map(function(pair){return '<div class="card"><div class="muted">'+esc(pair[0])+'</div><div class="value">'+esc(pair[1])+'</div></div>';}).join('');
    document.getElementById('matches').innerHTML=renderMatches(data.topMatches||[]);
    document.getElementById('recruiters').innerHTML=renderRecruiters(data.recruiterLeads||[]);
    const app=await fetch('/api/applications?limit=10'); const appData=await app.json(); document.getElementById('applications').innerHTML=renderApplications(appData.applications||[]);
  }catch(e){document.getElementById('status').textContent='API unavailable';}
}
document.querySelectorAll('[data-filter]').forEach(function(button){button.addEventListener('click',async function(){document.querySelectorAll('[data-filter]').forEach(function(b){b.classList.remove('active')});button.classList.add('active');const filter=button.dataset.filter;const url=filter==='ALL'?'/api/jobs?limit=10':'/api/jobs?limit=10&decision='+encodeURIComponent(filter);try{const response=await fetch(url);const data=await response.json();document.getElementById('matches').innerHTML=renderMatches((data.jobs||[]).map(function(x){return {role:x.role,company:x.company,location:x.location,url:x.url,decision:x.decision||'REJECT',score:x.score??0,reason:x.reason||'No match decision recorded.'};}));}catch(e){document.getElementById('matches').textContent='Unable to load jobs.';}})});
refresh();setInterval(refresh,15000);
</script></body></html>`;
