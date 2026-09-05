import { Database } from "../database/Database";
import { DeterministicMatchResult } from "./DeterministicJobMatcher";

export interface PersistedMatchResult {
  matchScore: number;
  decision: "APPLY" | "REJECT" | "REVIEW";
  matchedSkills: string[];
  missingSkills: string[];
  evidence: Array<{ type: string; detail: string }>;
  reason: string;
  evaluator: string;
  model: string | null;
  confidence: number;
}

export interface MatchDecisionRepository {
  save(
    jobOpportunityId: string,
    candidateProfileId: string,
    result: PersistedMatchResult,
    inputHash?: string
  ): Promise<void>;
}

export class PostgresMatchDecisionRepository implements MatchDecisionRepository {
  constructor(private readonly database: Database) {}

  async save(
    jobOpportunityId: string,
    candidateProfileId: string,
    result: PersistedMatchResult,
    inputHash?: string
  ): Promise<void> {
    await this.database.query(
      `
        INSERT INTO match_decisions (
          job_opportunity_id, candidate_profile_id, decision, match_score,
          matched_skills, missing_skills, evidence, reason, evaluator, model,
          confidence, input_hash
        )
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12)
        ON CONFLICT (job_opportunity_id, candidate_profile_id)
        DO UPDATE SET
          decision = EXCLUDED.decision,
          match_score = EXCLUDED.match_score,
          matched_skills = EXCLUDED.matched_skills,
          missing_skills = EXCLUDED.missing_skills,
          evidence = EXCLUDED.evidence,
          reason = EXCLUDED.reason,
          evaluator = EXCLUDED.evaluator,
          model = EXCLUDED.model,
          confidence = EXCLUDED.confidence,
          input_hash = EXCLUDED.input_hash,
          evaluated_at = NOW(),
          updated_at = NOW()
      `,
      [
        jobOpportunityId,
        candidateProfileId,
        result.decision,
        result.matchScore,
        JSON.stringify(result.matchedSkills),
        JSON.stringify(result.missingSkills),
        JSON.stringify(result.evidence),
        result.reason,
        result.evaluator,
        result.model,
        result.confidence,
        inputHash ?? null
      ]
    );
  }
}

export type { DeterministicMatchResult };
