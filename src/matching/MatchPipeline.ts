import { createHash } from "node:crypto";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";
import { DeterministicJobMatcher, DeterministicMatchResult, MatchEvidence } from "./DeterministicJobMatcher";
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

const APPLY_THRESHOLD = 30;
const REVIEW_THRESHOLD = 20;
const MATCHER_VERSION = "matcher-v5";

export class MatchPipeline {
  constructor(
    private readonly deterministic: DeterministicJobMatcher,
    private readonly semantic: SemanticJobMatcher | null,
    private readonly decisions: MatchDecisionRepository
  ) {}

  async evaluateAndPersist(job: JobOpportunity, profile: CandidateProfile): Promise<CombinedMatchResult> {
    const rawDeterministic = this.deterministic.evaluate(job, profile);
    const deterministic = applyRoleRelevanceGate(
      applyTechnologySafetyGate(rawDeterministic, job, profile),
      job,
      profile
    );
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
      evaluator: semantic ? "DETERMINISTIC_PLUS_AI" : semanticFallback ? "DETERMINISTIC_FALLBACK" : "DETERMINISTIC_RULES"
    }, result.inputHash);
    return result;
  }
}

function combine(deterministic: DeterministicMatchResult, semantic: SemanticMatchResult | null, job: JobOpportunity, profile: CandidateProfile, semanticFallback = false): CombinedMatchResult {
  const inputHash = `${MATCHER_VERSION}:${createHash("sha256").update(JSON.stringify({ jobId: job.id, jobVersion: job.updatedAt, profile })).digest("hex")}`;

  if (!semantic) {
    const fallbackReason = semanticFallback ? `${deterministic.reason} AI assessment unavailable; deterministic rules remain authoritative.` : deterministic.reason;
    return {
      score: deterministic.matchScore,
      decision: deterministic.decision,
      reason: fallbackReason,
      matchedSkills: deterministic.matchedSkills,
      missingSkills: deterministic.missingSkills,
      evidence: semanticFallback ? [...deterministic.evidence, { type: "AI_FALLBACK", detail: "Semantic matching was unavailable; deterministic rules remain authoritative." }] : deterministic.evidence,
      confidence: semanticFallback ? 0.75 : 1,
      model: null,
      inputHash,
      deterministic,
      semantic: null
    };
  }

  const score = Math.round(deterministic.matchScore * 0.6 + semantic.score * 0.4);
  // Deterministic matching owns hard eligibility and may never be upgraded by
  // semantic output. AI can refine an already-eligible APPLY into REVIEW, but
  // it cannot turn a deterministic REVIEW/REJECT into APPLY.
  const decision = deterministic.decision === "REJECT"
    ? "REJECT"
    : deterministic.decision === "REVIEW"
      ? "REVIEW"
      : score >= 60
        ? "APPLY"
        : "REVIEW";

  return {
    score,
    decision,
    reason: `${deterministic.reason} AI assessment: ${semantic.rationale}`,
    matchedSkills: unique([...deterministic.matchedSkills, ...semantic.strengths]),
    missingSkills: unique([...deterministic.missingSkills, ...semantic.gaps]),
    evidence: [...deterministic.evidence, ...semantic.strengths.map((detail) => ({ type: "AI_STRENGTH", detail })), ...semantic.gaps.map((detail) => ({ type: "AI_GAP", detail }))],
    confidence: semantic.confidence,
    model: semantic.model,
    inputHash,
    deterministic,
    semantic
  };
}

/**
 * The deterministic matcher intentionally scores broad full-stack roles, but
 * an explicitly named primary language outside the candidate's stack must not
 * silently become APPLY merely because generic skills such as JavaScript or
 * HTML also appear in the posting. This gate is conservative: it downgrades
 * only obvious primary-language mismatches to REVIEW and never creates a new
 * REJECT path.
 */
function applyTechnologySafetyGate(result: DeterministicMatchResult, job: JobOpportunity, profile: CandidateProfile): DeterministicMatchResult {
  if (result.decision !== "APPLY") return result;

  const title = job.title.toLowerCase();
  const profileSkills = new Set(profile.skills.map((skill) => skill.toLowerCase()));
  const primaryLanguages = ["haskell", "ruby", "java", "c#", "c++", "kotlin", "swift", "rust", "golang", "go"];
  const frontendSignals = ["react", "next.js", "nextjs", "javascript", "typescript", "node.js", "nodejs", "frontend", "front-end", "full stack", "full-stack"];
  const namedForeignLanguage = primaryLanguages.find((language) => title.includes(language));
  const hasCandidateLanguage = namedForeignLanguage ? profileSkills.has(namedForeignLanguage) : true;
  const hasRelevantTitleSignal = frontendSignals.some((signal) => title.includes(signal));

  if (namedForeignLanguage && !hasCandidateLanguage && !hasRelevantTitleSignal) {
    return {
      ...result,
      decision: "REVIEW",
      reason: `${result.reason} Technology safety gate: the title explicitly names ${namedForeignLanguage}, which is not in the candidate's declared stack; APPLY is blocked pending manual review.`,
      evidence: [...result.evidence, { type: "TECHNOLOGY_SAFETY_GATE", detail: `Primary title language ${namedForeignLanguage} is outside the candidate stack.` } as unknown as MatchEvidence]
    };
  }

  return result;
}

/**
 * Prevent generic keyword overlap from turning a backend-first title into a
 * frontend match. A role whose title explicitly leads with Java/.NET/Python/
 * PHP/Spring/Django/etc. is rejected unless the title itself identifies the
 * candidate's React/Next/frontend target. Full-stack titles remain eligible
 * when they do not declare a competing backend stack as the primary role.
 */
function applyRoleRelevanceGate(result: DeterministicMatchResult, job: JobOpportunity, profile: CandidateProfile): DeterministicMatchResult {
  if (result.decision === "REJECT") return result;

  const title = job.title.toLowerCase();
  const text = `${job.title}\n${job.description}`.toLowerCase();
  const frontendTitle = /\b(frontend|front-end|front end|react(?:\.js|js)?|next(?:\.js|js)?|web developer|ui developer|ui engineer|javascript developer|typescript developer)\b/i.test(title);
  const fullStackTitle = /\b(full[- ]stack|fullstack)\b/i.test(title);
  const backendPrimary = /\b(?:java|python|\.net|dotnet|c#|php|ruby|rails|django|spring boot|golang|go)\b/i.test(title);
  const backendRole = /\b(?:backend|back-end|back end|java developer|python developer|\.net developer|dotnet developer|spring boot developer|django developer|php developer|ruby developer|golang developer)\b/i.test(title);
  const reactOrNextInTitle = /\b(?:react(?:\.js|js)?|next(?:\.js|js)?)\b/i.test(title);
  const reactOrNextInBody = /\b(?:react(?:\.js|js)?|next(?:\.js|js)?)\b/i.test(text);
  const frontendResponsibility = /\b(?:frontend|front-end|front end)\b.{0,120}\b(?:develop|build|own|maintain|implement|deliver|responsib|experience)\b|\b(?:develop|build|own|maintain|implement|deliver|responsib|experience)\b.{0,120}\b(?:frontend|front-end|front end)\b/i.test(text);

  // A title such as "Senior Java Full Stack Developer" is not a React match
  // just because React appears somewhere in a long description. It must name
  // React/Next/frontend in the title to enter this user's primary queue.
  if ((backendRole || (backendPrimary && fullStackTitle)) && !frontendTitle && !reactOrNextInTitle) {
    return {
      ...result,
      matchScore: 0,
      decision: "REJECT",
      reason: "Role relevance gate: the posting is explicitly backend-first in its title and does not identify React, Next.js, or frontend work as the target role.",
      evidence: [...result.evidence, { type: "HARD_BLOCKER", detail: "Backend-first title without a React/Next.js/frontend title signal is not a frontend/full-stack React match." }]
    };
  }

  // For a generic full-stack title, require actual React/Next evidence rather
  // than accepting generic JavaScript/HTML/API overlap alone.
  if (fullStackTitle && !reactOrNextInTitle && !(reactOrNextInBody && frontendResponsibility)) {
    return {
      ...result,
      matchScore: Math.min(result.matchScore, 39),
      decision: "REVIEW",
      reason: `${result.reason} Role relevance gate: generic full-stack title lacks explicit React/Next.js frontend responsibility; manual review required.`,
      evidence: [...result.evidence, { type: "ROLE_FIT", detail: "Generic full-stack role requires explicit React/Next.js frontend responsibility before APPLY." }]
    };
  }

  // Do not allow a role with only incidental React mentions to pass when the
  // title is clearly another engineering discipline.
  if (backendPrimary && !frontendTitle && !fullStackTitle && !reactOrNextInTitle) {
    return {
      ...result,
      matchScore: 0,
      decision: "REJECT",
      reason: "Role relevance gate: competing backend technology is primary and React/Next.js is not the named role focus.",
      evidence: [...result.evidence, { type: "HARD_BLOCKER", detail: "Incidental frontend technology does not override a competing backend-first role." }]
    };
  }

  // Keep the helper parameter meaningful and make the candidate stack explicit
  // in the evidence path without inventing skills.
  void profile;
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
