import { Database } from "../database/Database";

export interface TailoredResumeRecord {
  applicationId: string;
  jobOpportunityId: string;
  candidateProfileId: string;
  jobTitle: string;
  sourceVersion: string;
  resumePath: string;
  atsScore: number;
  matchedKeywords: readonly string[];
  missingKeywords: readonly string[];
  warnings: readonly string[];
}

export interface TailoredResumeRepository {
  save(record: TailoredResumeRecord): Promise<void>;
}

export class PostgresTailoredResumeRepository implements TailoredResumeRepository {
  constructor(private readonly database: Database) {}

  async save(record: TailoredResumeRecord): Promise<void> {
    await this.database.query(
      `
        INSERT INTO tailored_resume_versions (
          application_id,
          job_opportunity_id,
          candidate_profile_id,
          job_title,
          source_version,
          resume_path,
          ats_score,
          matched_keywords,
          missing_keywords,
          warnings
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)
        ON CONFLICT (application_id)
        DO UPDATE SET
          job_opportunity_id = EXCLUDED.job_opportunity_id,
          candidate_profile_id = EXCLUDED.candidate_profile_id,
          job_title = EXCLUDED.job_title,
          source_version = EXCLUDED.source_version,
          resume_path = EXCLUDED.resume_path,
          ats_score = EXCLUDED.ats_score,
          matched_keywords = EXCLUDED.matched_keywords,
          missing_keywords = EXCLUDED.missing_keywords,
          warnings = EXCLUDED.warnings
      `,
      [
        record.applicationId,
        record.jobOpportunityId,
        record.candidateProfileId,
        record.jobTitle,
        record.sourceVersion,
        record.resumePath,
        record.atsScore,
        JSON.stringify(record.matchedKeywords),
        JSON.stringify(record.missingKeywords),
        JSON.stringify(record.warnings)
      ]
    );
  }
}
