import { PlaywrightJobPageRenderer } from "./RenderedJobPageRenderer";

describe("PlaywrightJobPageRenderer", () => {
  it("honors an already-aborted signal without launching a browser", async () => {
    const renderer = new PlaywrightJobPageRenderer();
    const controller = new AbortController();
    controller.abort();
    const result = await renderer.render("https://example.com", controller.signal);
    expect(result.result).toBeNull();
    expect(result.diagnostics.outcome).toBe("render_error");
    await expect(renderer.close()).resolves.toBeUndefined();
  });

  it("can be closed safely when no browser was created", async () => {
    const renderer = new PlaywrightJobPageRenderer();
    await expect(renderer.close()).resolves.toBeUndefined();
    await expect(renderer.close()).resolves.toBeUndefined();
  });
});
