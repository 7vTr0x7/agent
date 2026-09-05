import { JobEligibilityResult, JobSearchPolicy } from "./JobEligibility";

export type JobRankingTier = 1 | 2 | 3;

export interface JobRankingInput {
  eligibility: JobEligibilityResult;
  deterministicMatchScore: number | null;
  semanticMatchScore: number | null;
  postedAt: Date | null;
  now?: Date;
}

export interface JobRankingResult {
  score: number;
  tier: JobRankingTier | null;
  reason: string;
}

const MAX_MATCH_SCORE = 100;
const MAX_FRESHNESS_BONUS = 10;
const FRESHNESS_WINDOW_DAYS = 30;

export function rankJob(
  input: JobRankingInput,
  _policy: JobSearchPolicy
): JobRankingResult {
  if (input.eligibility.decision === "REJECT") {
    return {
      score: 0,
      tier: null,
      reason: "Rejected jobs cannot enter the application ranking."
    };
  }

  const locationScore = priorityToScore(input.eligibility.priority);
  const matchScore = combinedMatchScore(
    input.deterministicMatchScore,
    input.semanticMatchScore
  );
  const freshnessBonus = calculateFreshnessBonus(input.postedAt, input.now ?? new Date());

  const score = Math.min(100, Math.round(locationScore * 0.4 + matchScore * 0.5 + freshnessBonus));
  const tier = score >= 70 ? 1 : score >= 50 ? 2 : 3;

  return {
    score,
    tier,
    reason: `Location priority ${input.eligibility.priority ?? 3}, match score ${matchScore}, freshness bonus ${freshnessBonus}.`
  };
}

function priorityToScore(priority: JobEligibilityResult["priority"]): number {
  if (priority === 1) return 100;
  if (priority === 2) return 85;
  return 70;
}

function combinedMatchScore(
  deterministicMatchScore: number | null,
  semanticMatchScore: number | null
): number {
  const deterministic = clampScore(deterministicMatchScore ?? 0);
  const semantic = clampScore(semanticMatchScore ?? deterministic);

  if (deterministicMatchScore === null && semanticMatchScore === null) {
    return 0;
  }

  if (deterministicMatchScore === null) {
    return semantic;
  }

  if (semanticMatchScore === null) {
    return deterministic;
  }

  return Math.round(deterministic * 0.6 + semantic * 0.4);
}

function calculateFreshnessBonus(postedAt: Date | null, now: Date): number {
  if (!postedAt) return 0;

  const ageDays = Math.max(0, (now.getTime() - postedAt.getTime()) / 86_400_000);
  if (ageDays >= FRESHNESS_WINDOW_DAYS) return 0;

  return Math.round(MAX_FRESHNESS_BONUS * (1 - ageDays / FRESHNESS_WINDOW_DAYS));
}

function clampScore(score: number): number {
  return Math.min(MAX_MATCH_SCORE, Math.max(0, Math.round(score)));
}
