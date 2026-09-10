import { chromium, type Browser, type Page } from "playwright";

export interface RenderedJobPage {
  readonly html: string;
  readonly detailUrls: readonly string[];
}

export interface RenderDiagnostics {
  readonly outcome: "render_success" | "render_timeout" | "render_error";
  readonly detailUrls: number;
  readonly finalUrl?: string;
}

export interface RenderedPageRenderer {
  render(url: string, signal?: AbortSignal): Promise<{ result: RenderedJobPage | null; diagnostics: RenderDiagnostics }>;
  close(): Promise<void>;
}

const NAVIGATION_TIMEOUT_MS = 15000;
const DOM_SETTLE_MS = 1200;

/** Shared, bounded Playwright renderer for public pages only. */
export class PlaywrightJobPageRenderer implements RenderedPageRenderer {
  private browserPromise: Promise<Browser> | null = null;

  async render(url: string, signal?: AbortSignal): Promise<{ result: RenderedJobPage | null; diagnostics: RenderDiagnostics }> {
    if (signal?.aborted) {
      return { result: null, diagnostics: { outcome: "render_error", detailUrls: 0 } };
    }

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
        if (!response || !response.ok()) {
          return { result: null, diagnostics: { outcome: "render_error", detailUrls: 0, finalUrl: page.url() } };
        }
        if (aborted || signal?.aborted) return { result: null, diagnostics: { outcome: "render_error", detailUrls: 0, finalUrl: page.url() } };

        await page.waitForLoadState("networkidle", { timeout: 3500 }).catch(() => undefined);
        await page.waitForTimeout(DOM_SETTLE_MS).catch(() => undefined);
        if (aborted || signal?.aborted) return { result: null, diagnostics: { outcome: "render_error", detailUrls: 0, finalUrl: page.url() } };

        const html = await page.content();
        const detailUrls = await collectPublicJobLinks(page, page.url());
        return {
          result: { html, detailUrls },
          diagnostics: { outcome: "render_success", detailUrls: detailUrls.length, finalUrl: page.url() }
        };
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    } catch (error) {
      const timeout = error instanceof Error && /timeout/i.test(error.message);
      return {
        result: null,
        diagnostics: { outcome: timeout ? "render_timeout" : "render_error", detailUrls: 0, finalUrl: page?.url() }
      };
    } finally {
      await page?.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    const browser = this.browserPromise ? await this.browserPromise.catch(() => null) : null;
    this.browserPromise = null;
    await browser?.close().catch(() => undefined);
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({ headless: true });
    }
    return this.browserPromise;
  }
}

async function collectPublicJobLinks(page: Page, baseUrl: string): Promise<string[]> {
  const base = new URL(baseUrl);
  const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({
    href: (anchor as HTMLAnchorElement).href,
    text: (anchor.textContent ?? "").replace(/\\s+/g, " ").trim()
  })));
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
