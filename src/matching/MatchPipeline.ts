import { createHash } from "node:crypto";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";
import { DeterministicJobMatcher, DeterministicMatchResult } from "./DeterministicJobMatcher";
import { SemanticJobMatcher, SemanticMatchResult } from "./SemanticJobMatcher";
import { MatchDecisionRepository } from "./MatchDecisionRepository";

export interface CombinedMatchResult {
  score: number;
  decision: "APPLY" | "REVIEW" | "REJECT";
  reason: string;
  matchedSkills: string[];
  missingSkills: string[];
  evidence: Array<{ type: string; detail: string }>;
  confidence: number;
  model: string | null;
  inputHash: string;
  deterministic: DeterministicMatchResult;
  semantic: SemanticMatchResult | null;
}

export class MatchPipeline {
  constructor(
    private readonly deterministic: DeterministicJobMatcher,
    private readonly semantic: SemanticJobMatcher | null,
    private readonly decisions: MatchDecisionRepository
  ) {}

  async evaluateAndPersist(
    job: JobOpportunity,
    profile: CandidateProfile
  ): Promise<CombinedMatchResult> {
    const deterministic = this.deterministic.evaluate(job, profile);
    let semantic: SemanticMatchResult | null = null;
    let semanticFallback = false;

    if (deterministic.decision !== "REJECT" && this.semantic) {
      try {
        semantic = await this.semantic.evaluate(job, profile);
      } catch {
        semanticFallback = true;
      }
    }

    const result = combine(deterministic, semantic, job, profile, semanticFallback);

    await this.decisions.save(job.id, profile.id, {
      matchScore: result.score,
      decision: result.decision,
      matchedSkills: result.matchedSkills,
      missingSkills: result.missingSkills,
      evidence: result.evidence,
      reason: result.reason,
      model: result.model,
      confidence: result.confidence,
      evaluator: semantic
        ? "DETERMINISTIC_PLUS_AI"
        : semanticFallback
          ? "DETERMINISTIC_FALLBACK"
          : "DETERMINISTIC_RULES"
    }, result.inputHash);

    return result;
  }
}

function combine(
  deterministic: DeterministicMatchResult,
  semantic: SemanticMatchResult | null,
  job: JobOpportunity,
  profile: CandidateProfile,
  semanticFallback = false
): CombinedMatchResult {
  const inputHash = createHash("sha256")
    .update(JSON.stringify({ jobId: job.id, jobVersion: job.updatedAt, profile }))
    .digest("hex");

  if (!semantic) {
    const fallbackDecision = semanticFallback && deterministic.decision === "APPLY"
      ? "REVIEW"
      : deterministic.decision;
    const fallbackReason = semanticFallback
      ? `${deterministic.reason} AI assessment unavailable; manual review required.`
      : deterministic.reason;

    return {
      score: deterministic.matchScore,
      decision: fallbackDecision,
      reason: fallbackReason,
      matchedSkills: deterministic.matchedSkills,
      missingSkills: deterministic.missingSkills,
      evidence: semanticFallback
        ? [
            ...deterministic.evidence,
            { type: "AI_FALLBACK", detail: "Semantic matching was unavailable; deterministic rules were used." }
          ]
        : deterministic.evidence,
      confidence: semanticFallback ? 0.5 : 1,
      model: null,
      inputHash,
      deterministic,
      semantic: null
    };
  }

  const score = Math.round(deterministic.matchScore * 0.6 + semantic.score * 0.4);
  const decision = score >= 70 ? "APPLY" : score >= 40 ? "REVIEW" : "REJECT";

  return {
    score,
    decision,
    reason: `${deterministic.reason} AI assessment: ${semantic.rationale}`,
    matchedSkills: unique([...deterministic.matchedSkills, ...semantic.strengths]),
    missingSkills: unique([...deterministic.missingSkills, ...semantic.gaps]),
    evidence: [
      ...deterministic.evidence,
      ...semantic.strengths.map((detail) => ({ type: "AI_STRENGTH", detail })),
      ...semantic.gaps.map((detail) => ({ type: "AI_GAP", detail }))
    ],
    confidence: semantic.confidence,
    model: semantic.model,
    inputHash,
    deterministic,
    semantic
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
