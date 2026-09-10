import { chromium, type Browser, type Page } from "playwright";

export interface RenderedJobPage { readonly html: string; readonly detailUrls: readonly string[]; }
export interface RenderDiagnostics { readonly outcome: "render_success" | "render_timeout" | "render_error"; readonly detailUrls: number; readonly visibleJobs: number; readonly finalUrl?: string; }
export interface RenderedPageRenderer { render(url: string, signal?: AbortSignal): Promise<{ result: RenderedJobPage | null; diagnostics: RenderDiagnostics }>; close(): Promise<void>; }

const NAVIGATION_TIMEOUT_MS = 15000;
const DOM_SETTLE_MS = 1200;
const RENDER_CONCURRENCY = 4;

/** Shared Playwright renderer for public pages. It never attempts login/CAPTCHA bypasses. */
export class PlaywrightJobPageRenderer implements RenderedPageRenderer {
  private browserPromise: Promise<Browser> | null = null;
  private active = 0;
  private waiters: Array<() => void> = [];

  async render(url: string, signal?: AbortSignal): Promise<{ result: RenderedJobPage | null; diagnostics: RenderDiagnostics }> {
    if (signal?.aborted) return { result: null, diagnostics: { outcome: "render_error", detailUrls: 0, visibleJobs: 0 } };
    await this.acquire(signal);
    try {
      let page: Page | null = null;
      try {
        const browser = await this.getBrowser();
        page = await browser.newPage({ javaScriptEnabled: true });
        page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
        page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
        let aborted = false;
        const onAbort = (): void => { aborted = true; void page?.close().catch(() => undefined); };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
          if (!response || !response.ok() || aborted || signal?.aborted) return { result: null, diagnostics: { outcome: "render_error", detailUrls: 0, visibleJobs: 0, finalUrl: page.url() } };
          await page.waitForLoadState("networkidle", { timeout: 3500 }).catch(() => undefined);
          await page.waitForTimeout(DOM_SETTLE_MS).catch(() => undefined);
          if (aborted || signal?.aborted) return { result: null, diagnostics: { outcome: "render_error", detailUrls: 0, visibleJobs: 0, finalUrl: page.url() } };

          const visible = await extractVisibleJobs(page);
          const originalHtml = await page.content();
          const augmentedHtml = visible.jobs.length ? `${originalHtml}${visible.jsonLd}` : originalHtml;
          const detailUrls = await collectPublicJobLinks(page, page.url());
          return {
            result: { html: augmentedHtml, detailUrls },
            diagnostics: { outcome: "render_success", detailUrls: detailUrls.length, visibleJobs: visible.jobs.length, finalUrl: page.url() }
          };
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
      } catch (error) {
        const timeout = error instanceof Error && /timeout/i.test(error.message);
        return { result: null, diagnostics: { outcome: timeout ? "render_timeout" : "render_error", detailUrls: 0, visibleJobs: 0, finalUrl: page?.url() } };
      } finally {
        await page?.close().catch(() => undefined);
      }
    } finally {
      this.release();
    }
  }

  async close(): Promise<void> {
    const browser = this.browserPromise ? await this.browserPromise.catch(() => null) : null;
    this.browserPromise = null;
    await browser?.close().catch(() => undefined);
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    if (this.active < RENDER_CONCURRENCY) { this.active += 1; return; }
    await new Promise<void>((resolve) => {
      const waiter = (): void => { this.active += 1; resolve(); };
      this.waiters.push(waiter);
      if (signal?.aborted) {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve();
      }
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) this.browserPromise = chromium.launch({ headless: true });
    return this.browserPromise;
  }
}

interface VisibleExtraction { jobs: Array<{ title: string; company: string; description: string; url: string }>; jsonLd: string; }

async function extractVisibleJobs(page: Page): Promise<VisibleExtraction> {
  const jobs = await page.locator("article, [role='article'], [data-testid*='job'], [data-testid*='Job'], [class*='job-card'], [class*='JobCard'], [class*='job_result'], [class*='job-result']").evaluateAll((cards) => {
    const out: Array<{ title: string; company: string; description: string; url: string }> = [];
    for (const card of cards) {
      const element = card as HTMLElement;
      const text = (element.innerText ?? "").replace(/\s+/g, " ").trim();
      if (!text || text.length < 40) continue;
      const titleElement = element.querySelector("h1,h2,h3,h4,[data-testid*='title'],[class*='title'],a[href*='job'],a[href*='jobs']") as HTMLElement | null;
      const companyElement = element.querySelector("[itemprop='hiringOrganization'] [itemprop='name'],[itemprop='name'][class*='company'],[data-company],[data-testid*='company'],[data-testid*='employer'],[class*='company'],[class*='employer'],[aria-label*='Company'],[aria-label*='Employer']") as HTMLElement | null;
      const linkElement = element.querySelector("a[href]") as HTMLAnchorElement | null;
      const title = (titleElement?.innerText ?? titleElement?.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
      const company = (companyElement?.getAttribute("data-company") ?? companyElement?.innerText ?? companyElement?.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
      const explicitCompany = company || (text.match(/(?:company|employer|hiring organization)\s*[:\-]\s*([^|•]+?)(?:\s+(?:location|description|salary)\s*[:\-]|$)/i)?.[1] ?? "").trim();
      const description = (element.querySelector("[itemprop='description'],[data-testid*='description'],[class*='description'],p")?.textContent ?? text).replace(/\s+/g, " ").trim();
      const url = linkElement?.href ?? "";
      if (title && explicitCompany && description.length >= 40 && url) out.push({ title, company: explicitCompany, description, url });
    }
    return out;
  });

  const unique = new Map<string, { title: string; company: string; description: string; url: string }>();
  for (const job of jobs) {
    const key = job.url.trim().toLowerCase();
    if (!unique.has(key)) unique.set(key, job);
  }
  const values = [...unique.values()];
  const jsonLd = values.map((job) => `<script type="application/ld+json">${escapeJsonScript(JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: job.title, description: job.description, url: job.url, hiringOrganization: { "@type": "Organization", name: job.company } }))}</script>`).join("");
  return { jobs: values, jsonLd };
}

function escapeJsonScript(value: string): string { return value.replace(/<\//g, "<\\/"); }

async function collectPublicJobLinks(page: Page, baseUrl: string): Promise<string[]> {
  const base = new URL(baseUrl);
  const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({ href: (anchor as HTMLAnchorElement).href, text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim() })));
  const result = new Set<string>();
  for (const link of links) {
    if (!link.href || !looksLikeJobLink(link.href, link.text)) continue;
    try {
      const target = new URL(link.href, base);
      if (target.protocol !== "http:" && target.protocol !== "https:") continue;
      if (target.hostname !== base.hostname) continue;
      target.hash = "";
      result.add(target.toString());
    } catch { /* ignore malformed public links */ }
  }
  return [...result];
}

function looksLikeJobLink(href: string, text: string): boolean {
  const value = `${href} ${text}`.toLowerCase();
  if (!/(job|jobs|career|careers|position|opening|vacanc|requisition|role)/i.test(value)) return false;
  if (/^(login|sign[- ]?in|register|signup|cookie|privacy|terms|help|support|contact)/i.test(text.trim())) return false;
  return true;
}
