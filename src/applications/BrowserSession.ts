import { chromium, Browser, BrowserContext, Page } from "playwright";

export interface BrowserSessionOptions {
  headless?: boolean;
  storageStatePath?: string;
  navigationTimeoutMs?: number;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export class BrowserSessionService {
  constructor(private readonly options: BrowserSessionOptions = {}) {}

  async create(): Promise<BrowserSession> {
    const browser = await chromium.launch({
      headless: this.options.headless ?? true
    });

    const context = await browser.newContext(
      this.options.storageStatePath
        ? { storageState: this.options.storageStatePath }
        : undefined
    );

    if (this.options.navigationTimeoutMs !== undefined) {
      context.setDefaultNavigationTimeout(this.options.navigationTimeoutMs);
    }

    const page = await context.newPage();

    return { browser, context, page };
  }

  async close(session: BrowserSession): Promise<void> {
    await session.context.close();
    await session.browser.close();
  }
}
