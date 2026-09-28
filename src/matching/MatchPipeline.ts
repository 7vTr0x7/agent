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
const MATCHER_VERSION = "matcher-v6";

export class MatchPipeline {
  constructor(
    private readonly deterministic: DeterministicJobMatcher,
    private readonly semantic: SemanticJobMatcher | null,
    private readonly decisions: MatchDecisionRepository
  ) {}

  async evaluateAndPersist(job: JobOpportunity, profile: CandidateProfile): Promise<CombinedMatchResult> {
    const rawDeterministic = this.deterministic.evaluate(job, profile);
    const deterministic = applyRoleRelevanceGate(
      applyTechnologySafetyGate(promoteKnownRemoteBoardMatch(rawDeterministic, job), job, profile),
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

/** Promote strong matches from known remote-first boards when structured location is absent. */
export function promoteKnownRemoteBoardMatch(result: DeterministicMatchResult, job: JobOpportunity): DeterministicMatchResult {
  if (result.decision !== "REVIEW" || result.matchScore < 60 || result.geography !== "UNKNOWN") return result;

  const url = `${job.url ?? ""} ${job.canonicalUrl ?? ""}`.toLowerCase();
  const remoteBoard = /(?:^|[/:.])(?:remoteok\.com|remotefirstjobs\.com|jobicy\.com)(?:[/:?#]|$)/i.test(url);
  if (!remoteBoard) return result;

  const text = `${job.title}\n${job.description}\n${job.location ?? ""}\n${job.country ?? ""}`;
  const explicitForeignRestriction = /\b(?:remote|work from home|wfh)\b[^.\n]{0,100}\b(?:usa|u\.s\.a?\.?|united states|uk|u\.k\.?|united kingdom|canada|australia|singapore|europe|eu)\b|\b(?:usa|u\.s\.a?\.?|united states|uk|u\.k\.?|united kingdom|canada|australia|singapore)\s+(?:only|based|based only)\b/i.test(text);
  if (explicitForeignRestriction) return result;

  return {
    ...result,
    decision: "APPLY",
    geography: "REMOTE_WORLDWIDE",
    reason: `${result.reason} Remote-source normalization: known remote-first board establishes remote eligibility despite missing structured location.`
  };
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

  if ((backendRole || (backendPrimary && fullStackTitle)) && !frontendTitle && !reactOrNextInTitle) {
    return {
      ...result,
      matchScore: 0,
      decision: "REJECT",
      reason: "Role relevance gate: the posting is explicitly backend-first in its title and does not identify React, Next.js, or frontend work as the target role.",
      evidence: [...result.evidence, { type: "HARD_BLOCKER", detail: "Backend-first title without a React/Next.js/frontend title signal is not a frontend/full-stack React match." }]
    };
  }

  if (fullStackTitle && !reactOrNextInTitle && !(reactOrNextInBody && frontendResponsibility)) {
    return {
      ...result,
      matchScore: Math.min(result.matchScore, 39),
      decision: "REVIEW",
      reason: `${result.reason} Role relevance gate: generic full-stack title lacks explicit React/Next.js frontend responsibility; manual review required.`,
      evidence: [...result.evidence, { type: "ROLE_FIT", detail: "Generic full-stack role requires explicit React/Next.js frontend responsibility before APPLY." }]
    };
  }

  if (backendPrimary && !frontendTitle && !fullStackTitle && !reactOrNextInTitle) {
    return {
      ...result,
      matchScore: 0,
      decision: "REJECT",
      reason: "Role relevance gate: competing backend technology is primary and React/Next.js is not the named role focus.",
      evidence: [...result.evidence, { type: "HARD_BLOCKER", detail: "Incidental frontend technology does not override a competing backend-first role." }]
    };
  }

  void profile;
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
