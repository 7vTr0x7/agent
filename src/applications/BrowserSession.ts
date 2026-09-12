import { chromium, Browser, BrowserContext, Page } from "playwright";

export interface BrowserSessionOptions {
  headless?: boolean;
  storageStatePath?: string;
  navigationTimeoutMs?: number;
  launchTimeoutMs?: number;
  lifecycleTimeoutMs?: number;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000;
const DEFAULT_LIFECYCLE_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export class BrowserSessionService {
  private readonly activeSessions = new Set<BrowserSession>();

  constructor(private readonly options: BrowserSessionOptions = {}) {}

  async create(): Promise<BrowserSession> {
    const browser = await chromium.launch({
      headless: this.options.headless ?? true,
      timeout: this.options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS,
      handleSIGINT: true,
      handleSIGTERM: true,
      handleSIGHUP: true
    });

    let context: BrowserContext | undefined;
    let page: Page | undefined;
    try {
      context = await withTimeout(
        browser.newContext(
          this.options.storageStatePath
            ? { storageState: this.options.storageStatePath }
            : undefined
        ),
        this.options.lifecycleTimeoutMs ?? DEFAULT_LIFECYCLE_TIMEOUT_MS,
        "Timed out creating the Playwright browser context."
      );

      if (this.options.navigationTimeoutMs !== undefined) {
        context.setDefaultNavigationTimeout(this.options.navigationTimeoutMs);
      }

      page = await withTimeout(
        context.newPage(),
        this.options.lifecycleTimeoutMs ?? DEFAULT_LIFECYCLE_TIMEOUT_MS,
        "Timed out creating the Playwright page."
      );

      const session = { browser, context, page };
      this.activeSessions.add(session);
      return session;
    } catch (error) {
      if (context) {
        await this.closeContext(context).catch(() => undefined);
      }
      await this.closeBrowser(browser).catch(() => undefined);
      throw error;
    }
  }

  async close(session: BrowserSession): Promise<void> {
    this.activeSessions.delete(session);
    const errors: unknown[] = [];

    try {
      await withTimeout(
        session.page.close({ reason: "Phase 9 fixture lifecycle cleanup" }),
        this.options.lifecycleTimeoutMs ?? DEFAULT_LIFECYCLE_TIMEOUT_MS,
        "Timed out closing the Playwright page."
      );
    } catch (error) {
      errors.push(error);
    }

    try {
      await this.closeContext(session.context);
    } catch (error) {
      errors.push(error);
    }

    try {
      await this.closeBrowser(session.browser);
    } catch (error) {
      errors.push(error);
    }

    if (errors.length > 0) {
      throw errors[0];
    }
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.activeSessions];
    await Promise.allSettled(sessions.map((session) => this.close(session)));
  }

  activeSessionCount(): number {
    return this.activeSessions.size;
  }

  private async closeContext(context: BrowserContext): Promise<void> {
    await withTimeout(
      context.close({ reason: "Phase 9 fixture lifecycle cleanup" }),
      this.options.lifecycleTimeoutMs ?? DEFAULT_LIFECYCLE_TIMEOUT_MS,
      "Timed out closing the Playwright browser context."
    );
  }

  private async closeBrowser(browser: Browser): Promise<void> {
    await withTimeout(
      browser.close({ reason: "Phase 9 fixture lifecycle cleanup" }),
      this.options.lifecycleTimeoutMs ?? DEFAULT_LIFECYCLE_TIMEOUT_MS,
      "Timed out closing the Playwright browser."
    );
  }
}
