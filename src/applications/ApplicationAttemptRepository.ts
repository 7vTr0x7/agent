import { Database } from "../database/Database";

export interface ApplicationAttemptRecord {
  applicationId: string;
  adapterName: string | null;
  safetyAllowed: boolean;
  submitted: boolean;
  reason: string;
  confirmationUrl: string | null;
  externalApplicationId: string | null;
  attemptedAt?: Date;
}

export interface StoredApplicationAttempt extends ApplicationAttemptRecord {
  id: string;
  attemptedAt: Date;
}

export class ApplicationAttemptRepository {
  constructor(private readonly database: Database) {}

  async record(record: ApplicationAttemptRecord): Promise<StoredApplicationAttempt> {
    const result = await this.database.query<{
      id: string;
      attempted_at: Date;
    }>(
      `
        INSERT INTO application_attempts (
          application_id,
          adapter_name,
          safety_allowed,
          submitted,
          reason,
          confirmation_url,
          external_application_id,
          attempted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
        RETURNING id, attempted_at
      `,
      [
        record.applicationId,
        record.adapterName,
        record.safetyAllowed,
        record.submitted,
        record.reason,
        record.confirmationUrl,
        record.externalApplicationId,
        record.attemptedAt ?? null
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Application attempt could not be recorded.");
    }

    return {
      ...record,
      id: row.id,
      attemptedAt: row.attempted_at
    };
  }

  async listForApplication(applicationId: string): Promise<readonly StoredApplicationAttempt[]> {
    const result = await this.database.query<{
      id: string;
      application_id: string;
      adapter_name: string | null;
      safety_allowed: boolean;
      submitted: boolean;
      reason: string;
      confirmation_url: string | null;
      external_application_id: string | null;
      attempted_at: Date;
    }>(
      `
        SELECT
          id,
          application_id,
          adapter_name,
          safety_allowed,
          submitted,
          reason,
          confirmation_url,
          external_application_id,
          attempted_at
        FROM application_attempts
        WHERE application_id = $1
        ORDER BY attempted_at DESC, id DESC
      `,
      [applicationId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      applicationId: row.application_id,
      adapterName: row.adapter_name,
      safetyAllowed: row.safety_allowed,
      submitted: row.submitted,
      reason: row.reason,
      confirmationUrl: row.confirmation_url,
      externalApplicationId: row.external_application_id,
      attemptedAt: row.attempted_at
    }));
  }
}
