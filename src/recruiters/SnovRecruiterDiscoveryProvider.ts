import { RecruiterContactCandidate, RecruiterDiscoveryInput, RecruiterDiscoveryProvider, RecruiterDiscoveryResult, RecruiterVerificationResult } from "./RecruiterDiscovery";

const SNOV_API_BASE = "https://api.snov.io";
const RECRUITER_POSITIONS = ["Technical Recruiter", "Engineering Recruiter", "Talent Acquisition Partner", "Technical Talent Partner", "Recruiter", "Talent Acquisition", "Hiring Manager"];
interface SnovOptions { clientId: string; clientSecret: string; fetchImpl?: typeof fetch; pollAttempts?: number; pollDelayMs?: number; sleepImpl?: (delayMs: number) => Promise<void>; maxRetries?: number; retryDelayMs?: number; timeoutMs?: number; }
interface SnovTokenResponse { access_token?: string; expires_in?: number; }
interface SnovStartResponse { data?: { task_hash?: string }; links?: { result?: string }; }
interface SnovProspect { first_name?: string; last_name?: string; position?: string; source_page?: string; search_emails_start?: string; }
interface SnovProspectResult { data?: SnovProspect[]; status?: string; }
interface SnovEmailResult { data?: Array<{ email?: string; smtp_status?: string }>; status?: string; }
interface SnovVerificationResult { data?: Array<{ email?: string; status?: string; smtp_status?: string; score?: number }>; status?: string; }
function normalizeDomain(value: string): string { return value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? ""; }
function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
function validEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function isRecruiterPosition(position?: string): boolean { return /(recruit|talent|human\s*resources|\bhr\b|hiring|staffing)/i.test(position ?? ""); }

export class SnovRecruiterDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "snov";
  private readonly clientId: string; private readonly clientSecret: string; private readonly fetchImpl: typeof fetch; private readonly pollAttempts: number; private readonly pollDelayMs: number; private readonly sleepImpl: (delayMs: number) => Promise<void>; private readonly maxRetries: number; private readonly retryDelayMs: number; private readonly timeoutMs: number; private token: { value: string; expiresAt: number } | null = null;
  constructor(options: SnovOptions) { if (!options.clientId.trim() || !options.clientSecret.trim()) throw new Error("Snov API client credentials are required"); this.clientId = options.clientId.trim(); this.clientSecret = options.clientSecret.trim(); this.fetchImpl = options.fetchImpl ?? fetch; this.pollAttempts = Math.max(1, Math.floor(options.pollAttempts ?? 10)); this.pollDelayMs = Math.max(0, options.pollDelayMs ?? 1000); this.sleepImpl = options.sleepImpl ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))); this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 2)); this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 250); this.timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 15000)); }
  private async fetchWithResilience(url: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
        if (response.ok || (response.status !== 429 && response.status < 500) || attempt >= this.maxRetries) return response;
        const retryAfter = response.headers.get("retry-after");
        const parsedRetryAfter = retryAfter ? Number(retryAfter) : NaN;
        const delay = Number.isFinite(parsedRetryAfter) ? Math.min(30000, Math.max(0, parsedRetryAfter * 1000)) : this.retryDelayMs * 2 ** attempt;
        attempt += 1;
        await this.sleepImpl(delay);
      } catch (error) {
        if (attempt >= this.maxRetries) throw error;
        attempt += 1;
        await this.sleepImpl(this.retryDelayMs * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timeout);
      }
    }
  }
  private async getToken(): Promise<string> { if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value; const body = new URLSearchParams({ grant_type: "client_credentials", client_id: this.clientId, client_secret: this.clientSecret }); const response = await this.fetchWithResilience(`${SNOV_API_BASE}/v1/oauth/access_token`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body }); if (!response.ok) throw new Error(`Snov authentication failed with HTTP ${response.status}`); const payload = (await response.json()) as SnovTokenResponse; if (!payload.access_token) throw new Error("Snov authentication returned no access token"); this.token = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 }; return payload.access_token; }
  private async request<T>(url: string, init: RequestInit = {}): Promise<T> { const token = await this.getToken(); const response = await this.fetchWithResilience(url, { ...init, headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } }); if (!response.ok) throw new Error(`Snov request failed with HTTP ${response.status}`); return (await response.json()) as T; }
  private async poll<T>(url: string): Promise<T> { for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) { const result = await this.request<T>(url); if ((result as { status?: string }).status === "completed") return result; if (attempt + 1 < this.pollAttempts) await this.sleepImpl(this.pollDelayMs); } throw new Error("Snov asynchronous discovery did not complete within the configured polling window"); }
  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> { const domain = normalizeDomain(input.companyDomain); if (!domain) throw new Error("A valid company domain is required for Snov discovery"); const startUrl = new URL(`${SNOV_API_BASE}/v2/domain-search/prospects/start`); startUrl.searchParams.set("domain", domain); startUrl.searchParams.set("page", "1"); for (const position of RECRUITER_POSITIONS) startUrl.searchParams.append("positions[]", position); const started = await this.request<SnovStartResponse>(startUrl.toString(), { method: "POST" }); const taskHash = started.data?.task_hash; if (!taskHash) throw new Error("Snov prospect discovery returned no task hash"); const prospects = await this.poll<SnovProspectResult>(`${SNOV_API_BASE}/v2/domain-search/prospects/result/${taskHash}`); const contacts: RecruiterContactCandidate[] = []; for (const prospect of prospects.data ?? []) { if (!isRecruiterPosition(prospect.position) || !prospect.search_emails_start) continue; const emailStart = await this.request<SnovStartResponse>(prospect.search_emails_start, { method: "POST" }); const emailTask = emailStart.data?.task_hash; if (!emailTask) continue; const emails = await this.poll<SnovEmailResult>(`${SNOV_API_BASE}/v2/domain-search/prospects/search-emails/result/${emailTask}`); for (const item of emails.data ?? []) { if (!item.email) continue; const email = normalizeEmail(item.email); if (!validEmail(email) || email.split("@").pop() !== domain) continue; const verified = item.smtp_status === "valid"; contacts.push({ email, fullName: [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || undefined, title: prospect.position, confidence: verified ? 95 : 70, verified, verificationStatus: item.smtp_status, provider: this.name, sources: [{ url: prospect.source_page, type: "snov_prospect" }] }); } } return { provider: this.name, contacts, discoveredAt: new Date() }; }
  async verify(email: string): Promise<RecruiterVerificationResult> { const normalized = normalizeEmail(email); if (!validEmail(normalized)) return { email: normalized, verified: false, status: "invalid", confidence: 0 }; const form = new URLSearchParams(); form.append("emails[]", normalized); const started = await this.request<SnovStartResponse>(`${SNOV_API_BASE}/v2/email-verification/start`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form }); const taskHash = started.data?.task_hash; if (!taskHash) return { email: normalized, verified: false, status: "unknown" }; const result = await this.poll<SnovVerificationResult>(`${SNOV_API_BASE}/v2/email-verification/result?task_hash=${encodeURIComponent(taskHash)}`); const match = result.data?.find((item) => normalizeEmail(item.email ?? "") === normalized); const status = match?.status ?? match?.smtp_status ?? "unknown"; return { email: normalized, verified: status === "valid", status, confidence: match?.score }; }
}
