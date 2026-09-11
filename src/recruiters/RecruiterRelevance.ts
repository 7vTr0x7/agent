import { RecruiterIdentityCandidate } from "./RecruiterDiscovery";

export type RecruiterRelevanceStatus = "CURRENT" | "RECENT" | "HISTORICAL" | "UNKNOWN";

export interface RecruiterRelevanceClassification {
  status: RecruiterRelevanceStatus;
  score: number;
  evidence: string[];
}

/**
 * Classifies only evidence that the discovery pipeline can actually support.
 * Public search snippets are deliberately UNKNOWN: a search result is not proof
 * that a person is currently employed by, or hiring for, the employer.
 */
export function classifyRecruiterRelevance(candidate: RecruiterIdentityCandidate): RecruiterRelevanceClassification {
  const evidence = [...(candidate.sources ?? []), ...(candidate.discoveryEvidence ?? []).map((text) => ({ type: "discovery_text", url: undefined, confidence: undefined, text }))];
  const types = evidence.map((item) => item.type?.toLowerCase() ?? "");

  if (types.some((type) => type === "job_posting" || type === "current_job_posting" || type === "current_role")) {
    return {
      status: "CURRENT",
      score: 100,
      evidence: evidence.filter((item) => /job_posting|current_role/i.test(item.type ?? "")).map((item) => formatEvidence(item)).slice(0, 10)
    };
  }

  if (types.some((type) => type === "recent_job_posting" || type === "recent_role")) {
    return {
      status: "RECENT",
      score: 80,
      evidence: evidence.filter((item) => /recent_(job_posting|role)/i.test(item.type ?? "")).map((item) => formatEvidence(item)).slice(0, 10)
    };
  }

  if (types.some((type) => type === "historical_job_posting" || type === "historical_role")) {
    return {
      status: "HISTORICAL",
      score: 40,
      evidence: evidence.filter((item) => /historical_(job_posting|role)/i.test(item.type ?? "")).map((item) => formatEvidence(item)).slice(0, 10)
    };
  }

  return {
    status: "UNKNOWN",
    score: 0,
    evidence: evidence.map((item) => formatEvidence(item)).filter(Boolean).slice(0, 10)
  };
}

function formatEvidence(item: { url?: string; type?: string; confidence?: number; text?: string }): string {
  const parts = [item.type ? `type=${item.type}` : null, item.url ? `url=${item.url}` : null, typeof item.confidence === "number" ? `confidence=${item.confidence}` : null, item.text ? `text=${item.text.slice(0, 240)}` : null];
  return parts.filter(Boolean).join(" ");
}
