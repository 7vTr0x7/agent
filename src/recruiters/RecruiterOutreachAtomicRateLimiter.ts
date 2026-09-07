import { Database } from "../database/Database";

export interface RecruiterOutreachRateLimitReservation {
  allowed: boolean;
  reason?: "DAILY_LIMIT" | "HOURLY_LIMIT";
}

export class RecruiterOutreachAtomicRateLimiter {
  constructor(private readonly database: Database) {}

  async reserve(maxMessagesPerDay: number, maxMessagesPerHour: number): Promise<RecruiterOutreachRateLimitReservation> {
    if (!Number.isInteger(maxMessagesPerDay) || maxMessagesPerDay < 1) {
      throw new Error("Recruiter daily send limit must be a positive integer.");
    }
    if (!Number.isInteger(maxMessagesPerHour) || maxMessagesPerHour < 1) {
      throw new Error("Recruiter hourly send limit must be a positive integer.");
    }

    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('job-agent:recruiter-outreach-rate-limit'))");

      const result = await client.query<{ day_count: string; hour_count: string }>(`
        SELECT
          COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '24 hours')::text AS day_count,
          COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '1 hour')::text AS hour_count
        FROM recruiter_outreach_messages
        WHERE status = 'SENT'
      `);

      const dayCount = Number(result.rows[0]?.day_count ?? 0);
      const hourCount = Number(result.rows[0]?.hour_count ?? 0);

      if (dayCount >= maxMessagesPerDay) return { allowed: false, reason: "DAILY_LIMIT" };
      if (hourCount >= maxMessagesPerHour) return { allowed: false, reason: "HOURLY_LIMIT" };
      return { allowed: true };
    });
  }
}
