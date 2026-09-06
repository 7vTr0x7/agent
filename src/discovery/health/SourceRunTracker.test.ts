import { Database } from "../../database/Database";
import { SourceRunTracker } from "./SourceRunTracker";

describe("SourceRunTracker", () => {
  it("persists the latest source cooldown without shortening an existing one", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const database = { query } as unknown as Database;
    const tracker = new SourceRunTracker(database);
    const disabledUntil = new Date("2026-09-06T10:00:00.000Z");

    await tracker.applyCooldown("greenhouse", disabledUntil);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("disabled_until = CASE"),
      ["greenhouse", disabledUntil]
    );
  });
});
