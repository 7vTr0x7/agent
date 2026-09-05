import { Database } from "../../database/Database";
import { SourceDescriptor } from "../policy/SourcePolicy";

export class SourceHealthGate {
  constructor(private readonly database: Database) {}

  async canRun(descriptor: SourceDescriptor): Promise<boolean> {
    if (
      descriptor.policy.status !== "APPROVED" ||
      !descriptor.policy.allowedSourceTypes.includes(descriptor.type)
    ) {
      return false;
    }

    const result = await this.database.query<{ status: string }>(
      `SELECT status FROM sources WHERE id = $1`,
      [descriptor.id]
    );

    return result.rows[0]?.status === undefined || result.rows[0].status === "APPROVED";
  }
}
