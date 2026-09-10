import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import { Database } from "../database/Database";

interface SummaryRow {
  jobs: string;
  matches: string;
  applications: string;
  recruiters: string;
  outreachSent: string;
  pendingTasks: string;
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
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT must be a valid TCP port.");

    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        writeJson(response, 500, { status: "ERROR", error: "Internal server error" });
        void error;
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

    if (url.pathname === "/api/summary") {
      const summary = await this.database.query<SummaryRow>(`
        SELECT
          (SELECT COUNT(*)::text FROM job_opportunities) AS jobs,
          (SELECT COUNT(*)::text FROM match_decisions) AS matches,
          (SELECT COUNT(*)::text FROM applications) AS applications,
          (SELECT COUNT(*)::text FROM recruiter_contacts) AS recruiters,
          (SELECT COUNT(*)::text FROM recruiter_outreach_messages WHERE status='SENT') AS "outreachSent",
          (SELECT COUNT(*)::text FROM tasks WHERE status IN ('PENDING','RUNNING')) AS "pendingTasks"
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

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job Agent</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px;background:#f6f7f9;color:#17202a}main{max-width:1000px;margin:auto}h1{margin-bottom:4px}.muted{color:#667085}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-top:24px}.card{background:white;border:1px solid #e4e7ec;border-radius:12px;padding:20px}.value{font-size:32px;font-weight:700;margin-top:8px}.status{margin-top:24px;padding:12px;border-radius:8px;background:white;border:1px solid #e4e7ec}</style>
</head>
<body><main><h1>Job Agent</h1><div class="muted">Live operational dashboard</div><div id="status" class="status">Loading…</div><div id="grid" class="grid"></div></main>
<script>
async function refresh(){try{const health=await fetch('/healthz');const data=await fetch('/api/summary').then(r=>r.json());document.getElementById('status').textContent=health.ok?'Database connected':'Database unavailable';document.getElementById('grid').innerHTML=Object.entries(data).map(([k,v])=>'<div class="card"><div class="muted">'+k.replace(/[A-Z]/g,m=>' '+m).toUpperCase()+'</div><div class="value">'+v+'</div></div>').join('')}catch(e){document.getElementById('status').textContent='API unavailable'}}refresh();setInterval(refresh,15000);
</script></body></html>`;
