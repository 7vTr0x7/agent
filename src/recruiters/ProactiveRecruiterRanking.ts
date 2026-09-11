export interface ProactiveRecruiterCandidate {
  id: string;
  roleMatchScore: number;
  hiringEvidenceScore: number;
  evidenceFreshnessScore: number;
  employerRelevanceScore: number;
  emailConfidenceScore: number;
  locationRelevanceScore: number;
  priorEngagementScore?: number;
  suppressed?: boolean;
  recentlyContacted?: boolean;
  negativeResponse?: boolean;
}

export function rankProactiveRecruiters(items: ProactiveRecruiterCandidate[]): ProactiveRecruiterCandidate[] {
  const score = (r: ProactiveRecruiterCandidate) => {
    if (r.suppressed) return Number.NEGATIVE_INFINITY;
    return r.roleMatchScore * 0.30 + r.hiringEvidenceScore * 0.25 + r.evidenceFreshnessScore * 0.15 +
      r.employerRelevanceScore * 0.10 + r.emailConfidenceScore * 0.10 + r.locationRelevanceScore * 0.05 +
      (r.priorEngagementScore ?? 0) * 0.05 - (r.recentlyContacted ? 30 : 0) - (r.negativeResponse ? 100 : 0);
  };
  return [...items].filter((r) => !r.suppressed).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
}
