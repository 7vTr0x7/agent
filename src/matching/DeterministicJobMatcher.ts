import { JobOpportunity } from "../jobs/domain/JobOpportunity";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobDecision } from "../shared/types/job";

export interface MatchEvidence {
  type: "SKILL_MATCH" | "SKILL_GAP" | "TITLE_MATCH" | "EXPERIENCE" | "HARD_BLOCKER";
  detail: string;
}

export interface DeterministicMatchResult {
  matchScore: number;
  decision: JobDecision;
  matchedSkills: string[];
  missingSkills: string[];
  evidence: MatchEvidence[];
  reason: string;
}

export interface DeterministicMatcherOptions {
  applyThreshold?: number;
  reviewThreshold?: number;
}

export class DeterministicJobMatcher {
  private readonly applyThreshold: number;
  private readonly reviewThreshold: number;

  constructor(options: DeterministicMatcherOptions = {}) {
    this.applyThreshold = options.applyThreshold ?? 70;
    this.reviewThreshold = options.reviewThreshold ?? 40;
  }

  evaluate(job: JobOpportunity, profile: CandidateProfile): DeterministicMatchResult {
    const text = `${job.title}\n${job.description}`.toLowerCase();
    const normalizedText = normalize(text);
    const evidence: MatchEvidence[] = [];

    const matchedSkills = profile.skills.filter((skill) =>
      containsTerm(normalizedText, skill)
    );
    const missingSkills = profile.skills.filter(
      (skill) => !containsTerm(normalizedText, skill)
    );

    for (const skill of matchedSkills) {
      evidence.push({ type: "SKILL_MATCH", detail: `Candidate skill appears in job: ${skill}` });
    }

    const titleMatch = profile.targetTitles.some((title) =>
      containsTerm(normalize(job.title), title)
    );
    if (titleMatch) {
      evidence.push({ type: "TITLE_MATCH", detail: "Job title matches a target title." });
    }

    const requiredYears = extractRequiredYears(normalizedText);
    if (requiredYears !== null) {
      if (requiredYears > profile.yearsExperience) {
        evidence.push({
          type: "HARD_BLOCKER",
          detail: `Job requires approximately ${requiredYears}+ years; candidate has ${profile.yearsExperience}.`
        });
        return {
          matchScore: 0,
          decision: "REJECT",
          matchedSkills,
          missingSkills,
          evidence,
          reason: "Deterministic experience requirement exceeds candidate experience."
        };
      }

      evidence.push({
        type: "EXPERIENCE",
        detail: `Candidate meets the detected ${requiredYears}+ year requirement.`
      });
    }

    for (const skill of missingSkills) {
      evidence.push({ type: "SKILL_GAP", detail: `Candidate skill not found in job text: ${skill}` });
    }

    const skillScore = profile.skills.length === 0
      ? 0
      : Math.round((matchedSkills.length / profile.skills.length) * 70);
    const titleBonus = titleMatch ? 20 : 0;
    const experienceBonus = requiredYears !== null && requiredYears <= profile.yearsExperience ? 10 : 0;
    const matchScore = Math.min(100, skillScore + titleBonus + experienceBonus);

    const decision: JobDecision =
      matchScore >= this.applyThreshold
        ? "APPLY"
        : matchScore >= this.reviewThreshold
          ? "REVIEW"
          : "REJECT";

    return {
      matchScore,
      decision,
      matchedSkills,
      missingSkills,
      evidence,
      reason: `${matchedSkills.length}/${profile.skills.length} candidate skills found; ` +
        `${titleMatch ? "target title matched" : "target title not matched"}.`
    };
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}

function containsTerm(text: string, term: string): boolean {
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return false;
  return (` ${text} `).includes(` ${normalizedTerm} `);
}

function extractRequiredYears(text: string): number | null {
  const matches = [
    ...text.matchAll(/(?:minimum|at least|required|must have|have)\s+(\d+(?:\.\d+)?)\s*\+?\s*years?/g),
    ...text.matchAll(/(\d+(?:\.\d+)?)\s*\+\s*years?\s+(?:of\s+)?experience/g)
  ];

  const years = matches
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));

  return years.length > 0 ? Math.max(...years) : null;
}
