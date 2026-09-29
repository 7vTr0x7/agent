  if (!role) return { score: 0, terms: [] };
  return { role, score: Math.min(100, score), terms: [...new Set(terms)] };
}
function extractRole(text: string): { role?: string; score: number; terms: string[] } { return substantiveRoleEvidence(text); }

export function experienceCompatible(text: string, candidateYears = 3): boolean {
  const ranges = [...text.matchAll(/(\d+)\s*(?:-|to|–|—)\s*(\d+)\s*years?/gi)].map(m => [Number(m[1]), Number(m[2])] as const);
  const minimums = [...text.matchAll(/(?:\b|\D)(\d+)\s*\+\s*years?/gi)].map(m => Number(m[1]));
  if (!ranges.length && !minimums.length) return true;

  // A single lower experience band remains valid for a more experienced
  // candidate (for example, a 1-2 year posting can still be considered for
  // a 3-year candidate). Once a post explicitly lists multiple seniority
  // bands, however, the candidate must fit at least one complete band.
  if (ranges.length + minimums.length === 1) {
    if (ranges.length) return candidateYears >= ranges[0]![0];
    return candidateYears >= minimums[0]!;
  }

  return ranges.some(([min, max]) => candidateYears >= min && candidateYears <= max) || minimums.some(min => candidateYears >= min);
}
