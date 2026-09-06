import { Database } from "../../database/Database";
import { SourceDescriptor } from "../policy/SourcePolicy";

interface SourceHealthRow {
  status: string;
  disabled_until: Date | null;
}

export class SourceHealthGate {
  constructor(private readonly database: Database) {}

  async canRun(descriptor: SourceDescriptor): Promise<boolean> {
    if (
      descriptor.policy.status !== "APPROVED" ||
      !descriptor.policy.allowedSourceTypes.includes(descriptor.type)
    ) {
      return false;
    }

    const result = await this.database.query<SourceHealthRow>(
      `SELECT status, disabled_until FROM sources WHERE id = $1`,
      [descriptor.id]
    );

    const source = result.rows[0];
    if (!source) return true;
    if (source.status !== "APPROVED") return false;

    return source.disabled_until === null || source.disabled_until <= new Date();
  }
}
