import { Database } from "../../database/Database";

export interface ExternalSideEffectGateResult {
  allowed: boolean;
  reason: string;
}

/**
 * Database-backed global kill switch for irreversible external side effects.
 * The database row defaults to kill_switch_active=true, so a fresh environment
 * fails closed until an operator explicitly clears the switch.
 */
export class GlobalExternalSideEffectGate {
  constructor(private readonly database: Database) {}

  async evaluate(): Promise<ExternalSideEffectGateResult> {
    const result = await this.database.query<{ kill_switch_active: boolean }>(
      "SELECT kill_switch_active FROM runtime_safety_controls WHERE id=TRUE"
    );
    if (!result.rows[0]) {
      return { allowed: false, reason: "Global external-side-effect control is missing; refusing to execute an irreversible action." };
    }
    if (result.rows[0].kill_switch_active) {
      return { allowed: false, reason: "Global emergency stop is active; external side effects are disabled." };
    }
    return { allowed: true, reason: "Global emergency stop is inactive." };
  }

  async assertAllowed(): Promise<void> {
    const result = await this.evaluate();
    if (!result.allowed) throw new Error(result.reason);
  }

  async setKillSwitch(active: boolean, reason: string): Promise<void> {
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new Error("A non-empty reason is required when changing the global kill switch.");
    await this.database.query(
      "UPDATE runtime_safety_controls SET kill_switch_active=$1, reason=$2, updated_at=NOW() WHERE id=TRUE",
      [active, trimmedReason]
    );
  }
}
