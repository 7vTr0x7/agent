import { GlobalExternalSideEffectGate } from "./GlobalExternalSideEffectGate";

describe("GlobalExternalSideEffectGate", () => {
  it("fails closed when the control row is missing", async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [] }) } as any;
    const gate = new GlobalExternalSideEffectGate(database);
    await expect(gate.evaluate()).resolves.toEqual({ allowed: false, reason: "Global external-side-effect control is missing; refusing to execute an irreversible action." });
  });

  it("blocks while the emergency stop is active", async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [{ kill_switch_active: true }] }) } as any;
    const gate = new GlobalExternalSideEffectGate(database);
    await expect(gate.evaluate()).resolves.toEqual({ allowed: false, reason: "Global emergency stop is active; external side effects are disabled." });
  });

  it("allows only when the persisted emergency stop is inactive", async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [{ kill_switch_active: false }] }) } as any;
    const gate = new GlobalExternalSideEffectGate(database);
    await expect(gate.evaluate()).resolves.toEqual({ allowed: true, reason: "Global emergency stop is inactive." });
  });

  it("requires an audit reason when changing the kill switch", async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [] }) } as any;
    const gate = new GlobalExternalSideEffectGate(database);
    await expect(gate.setKillSwitch(false, "  ")).rejects.toThrow("A non-empty reason is required");
    await gate.setKillSwitch(false, "approved controlled activation");
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE runtime_safety_controls"), [false, "approved controlled activation"]);
  });
});
