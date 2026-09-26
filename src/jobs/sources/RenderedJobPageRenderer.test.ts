jest.mock("playwright", () => ({
  chromium: {
    launch: jest.fn()
  }
}));

import { chromium } from "playwright";
import { PlaywrightJobPageRenderer } from "./RenderedJobPageRenderer";

describe("PlaywrightJobPageRenderer", () => {
  afterEach(() => jest.clearAllMocks());

  it("honors an already-aborted signal without launching a browser", async () => {
    const renderer = new PlaywrightJobPageRenderer();
    const controller = new AbortController();
    controller.abort();
    const result = await renderer.render("https://example.com", controller.signal);
    expect(result.result).toBeNull();
    expect(result.diagnostics.outcome).toBe("render_error");
    expect(chromium.launch).not.toHaveBeenCalled();
    await expect(renderer.close()).resolves.toBeUndefined();
  });

  it("can be closed safely when no browser was created", async () => {
    const renderer = new PlaywrightJobPageRenderer();
    await expect(renderer.close()).resolves.toBeUndefined();
    await expect(renderer.close()).resolves.toBeUndefined();
  });

  it("closes the shared browser after the renderer becomes idle", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const page = {
      goto: jest.fn().mockResolvedValue({ ok: () => true }),
      setDefaultNavigationTimeout: jest.fn(),
      setDefaultTimeout: jest.fn(),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockReturnValue({ evaluateAll: jest.fn().mockResolvedValue([]) }),
      content: jest.fn().mockResolvedValue("<html></html>"),
      url: jest.fn().mockReturnValue("https://example.com/jobs"),
      close: jest.fn().mockResolvedValue(undefined),
      context: jest.fn().mockReturnValue({ browser: () => ({ close }) })
    };
    const browser = {
      isConnected: jest.fn().mockReturnValue(true),
      newPage: jest.fn().mockResolvedValue(page),
      close
    };
    (chromium.launch as jest.Mock).mockResolvedValue(browser);

    const renderer = new PlaywrightJobPageRenderer();
    const result = await renderer.render("https://example.com/jobs");

    expect(result.diagnostics.outcome).toBe("render_success");
    expect(page.close).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
