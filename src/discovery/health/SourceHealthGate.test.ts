import { Database } from "../../database/Database";
import { SourceDescriptor } from "../policy/SourcePolicy";
import { SourceHealthGate } from "./SourceHealthGate";

const descriptor: SourceDescriptor = {
  id: "greenhouse",
  name: "Greenhouse",
  type: "ats",
  policy: {
    status: "APPROVED",
    allowedSourceTypes: ["ats"]
  }
};

describe("SourceHealthGate", () => {
  function createDatabase(rows: Array<{ status: string; disabled_until: Date | null }>): Database {
    return {
      query: jest.fn().mockResolvedValue({ rows })
    } as unknown as Database;
  }

  it("allows an approved source with no cooldown", async () => {
    const database = createDatabase([{ status: "APPROVED", disabled_until: null }]);

    await expect(new SourceHealthGate(database).canRun(descriptor)).resolves.toBe(true);
  });

  it("skips an approved source while its cooldown is active", async () => {
    const database = createDatabase([
      { status: "APPROVED", disabled_until: new Date(Date.now() + 60_000) }
    ]);

    await expect(new SourceHealthGate(database).canRun(descriptor)).resolves.toBe(false);
  });

  it("allows an approved source after its cooldown expires", async () => {
    const database = createDatabase([
      { status: "APPROVED", disabled_until: new Date(Date.now() - 60_000) }
    ]);

    await expect(new SourceHealthGate(database).canRun(descriptor)).resolves.toBe(true);
  });

  it("skips disabled or review-required sources", async () => {
    const database = createDatabase([{ status: "REVIEW_REQUIRED", disabled_until: null }]);

    await expect(new SourceHealthGate(database).canRun(descriptor)).resolves.toBe(false);
  });

  it("allows a source that has not been persisted yet", async () => {
    const database = createDatabase([]);

    await expect(new SourceHealthGate(database).canRun(descriptor)).resolves.toBe(true);
  });
});
