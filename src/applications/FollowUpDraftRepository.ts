import { Database } from "../database/Database";

export interface FollowUpCandidate {
  applicationId: string;
  jobTitle: string;
  companyName: string;
  appliedAt: Date;
  lastFollowUpAt: Date | null;
  nextFollowUpAt: Date | null;
  hasRecruiterResponse: boolean;
  status: string;
}

export interface FollowUpDraft {
  id: string;
  applicationId: string;
  subject: string;
  bodyText: string;
  status: "DRAFT" | "APPROVED" | "SENT" | "CANCELLED";
}

export class FollowUpDraftRepository {
  constructor(private readonly database: Database) {}

  async findCandidates(limit = 50): Promise<readonly FollowUpCandidate[]> {
    const result = await this.database.query<FollowUpCandidate>(
      `
      SELECT
        a.id AS "applicationId",
        jo.title AS "jobTitle",
        jo.company_name AS "companyName",
        a.applied_at AS "appliedAt",
        a.last_follow_up_at AS "lastFollowUpAt",
        a.next_follow_up_at AS "nextFollowUpAt",
        EXISTS (
          SELECT 1
          FROM gmail_messages gm
          WHERE gm.application_id = a.id
            AND gm.classification IN ('INTERVIEW','POSITIVE','REJECTION','APPLICATION_CONFIRMATION','OTHER')
            AND gm.received_at >= COALESCE(a.last_follow_up_at, a.applied_at)
        ) AS "hasRecruiterResponse",
        a.status
      FROM applications a
      INNER JOIN job_opportunities jo ON jo.id = a.job_opportunity_id
      WHERE a.status IN ('SENT','FOLLOW_UP_DUE')
        AND a.applied_at IS NOT NULL
      ORDER BY COALESCE(a.next_follow_up_at, a.applied_at) ASC, a.applied_at ASC
      LIMIT $1
      `,
      [limit]
    );
    return result.rows;
  }

  async markDue(applicationId: string, nextFollowUpAt: Date): Promise<boolean> {
    const result = await this.database.query(
      `
      UPDATE applications
      SET status = 'FOLLOW_UP_DUE',
          next_follow_up_at = $2,
          updated_at = NOW()
      WHERE id = $1
        AND status IN ('SENT','FOLLOW_UP_DUE')
      `,
      [applicationId, nextFollowUpAt]
    );
    return result.rowCount === 1;
  }

  async createDraft(applicationId: string, subject: string, bodyText: string): Promise<FollowUpDraft> {
    const result = await this.database.query<FollowUpDraft>(
      `
      INSERT INTO follow_up_drafts (application_id, subject, body_text, status)
      VALUES ($1,$2,$3,'DRAFT')
      ON CONFLICT (application_id) DO UPDATE SET updated_at = NOW()
      RETURNING
        id,
        application_id AS "applicationId",
        subject,
        body_text AS "bodyText",
        status
      `,
      [applicationId, subject, bodyText]
    );
    const draft = result.rows[0];
    if (!draft) throw new Error(`Failed to create follow-up draft for application '${applicationId}'.`);
    return draft;
  }
}
