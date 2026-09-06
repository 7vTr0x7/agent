import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";

const HUNTER_API_BASE = "https://api.hunter.io/v2";

interface HunterSource {
  uri?: string;
  type?: string;
  confidence?: number;
}

interface HunterEmail {
  value?: string;
  type?: string;
  confidence?: number;
  first_name?: string;
  last_name?: string;
  position?: string;
  seniority?: string;
  department?: string;
  country?: string;
  state?: string;
  city?: string;
  verification?: { status?: string; date?: string | null };
  sources?: HunterSource[];
}

interface HunterDomainSearchResponse {
  data?: {
    domain?: string;
    organization?: string | null;
    emails?: HunterEmail[];
  };
}

interface HunterVerifierResponse {
  data?: {
    status?: string;
    score?: number;
  };
}

export interface HunterRecruiterDiscoveryProviderOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryDelayMs?: number;
  sleepImpl?: (delayMs: number) => Promise<void>;
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  return withoutProtocol.split("/")[0]?.replace(/^www\./, "") ?? "";
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isRecruitingContact(email: HunterEmail): boolean {
  const text = [email.position, email.department, email.seniority, email.value]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /(recruit|talent|human\s*resources|\bhr\b|people\s*ops|hiring|staffing)/i.test(text);
}

function isUsableProfessionalEmail(email: HunterEmail, domain: string): boolean {
  if (!email.value) return false;
  const value = normalizeEmail(email.value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
  const emailDomain = value.split("@").pop() ?? "";
  if (emailDomain !== domain) return false;
  if (email.type === "generic") return true;
  return email.type === "personal" || email.type === undefined;
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelay(response: Response, fallbackMs: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return fallbackMs;
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds < 0) return fallbackMs;
  return Math.min(seconds * 1000, 30_000);
}

export class HunterRecruiterDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "hunter";
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly sleepImpl: (delayMs: number) => Promise<void>;

  constructor(options: HunterRecruiterDiscoveryProviderOptions) {
    if (!options.apiKey.trim()) throw new Error("Hunter API key is required");
    this.apiKey = options.apiKey.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 2));
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
    this.sleepImpl = options.sleepImpl ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  private async requestJson<T>(url: URL, operation: string): Promise<T> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.fetchImpl(url, { headers: { Accept: "application/json" } });
      if (response.ok) return (await response.json()) as T;

      if (!isTransientStatus(response.status) || attempt === this.maxRetries) {
        throw new Error(`Hunter ${operation} failed with HTTP ${response.status}`);
      }

      await this.sleepImpl(retryDelay(response, this.retryDelayMs));
    }

    throw new Error(`Hunter ${operation} failed without a response`);
  }

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const domain = normalizeDomain(input.companyDomain);
    if (!domain) throw new Error("A valid company domain is required for Hunter discovery");

    const url = new URL(`${HUNTER_API_BASE}/domain-search`);
    url.searchParams.set("domain", domain);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("limit", "100");

    const payload = await this.requestJson<HunterDomainSearchResponse>(url, "domain search");

    const contacts = (payload.data?.emails ?? [])
      .filter((email) => isUsableProfessionalEmail(email, domain))
      .filter(isRecruitingContact)
      .map((email): RecruiterContactCandidate => ({
        email: normalizeEmail(email.value!),
        fullName: [email.first_name, email.last_name].filter(Boolean).join(" ") || undefined,
        title: email.position,
        department: email.department,
        seniority: email.seniority,
        country: email.country,
        location: [email.city, email.state].filter(Boolean).join(", ") || undefined,
        confidence: email.confidence,
        verified: email.verification?.status === "valid",
        verificationStatus: email.verification?.status,
        provider: this.name,
        sources: (email.sources ?? []).map((source) => ({
          url: source.uri,
          type: source.type,
          confidence: source.confidence
        }))
      }));

    return {
      provider: this.name,
      contacts,
      discoveredAt: new Date()
    };
  }

  async verify(email: string): Promise<RecruiterVerificationResult> {
    const normalized = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return { email: normalized, verified: false, status: "invalid", confidence: 0 };
    }

    const url = new URL(`${HUNTER_API_BASE}/email-verifier`);
    url.searchParams.set("email", normalized);
    url.searchParams.set("api_key", this.apiKey);

    const payload = await this.requestJson<HunterVerifierResponse>(url, "email verification");
    const status = payload.data?.status ?? "unknown";
    const confidence = payload.data?.score;
    return {
      email: normalized,
      verified: status === "valid",
      status,
      confidence
    };
  }
}

export function normalizeHunterCompanyDomain(value: string): string {
  return normalizeDomain(value);
}
