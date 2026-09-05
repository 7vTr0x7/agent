import { createHash } from "node:crypto";
import { AIProvider } from "../shared/types/ai";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";
import { CandidateProfile } from "../candidates/CandidateProfile";

export interface SemanticMatchResult {
  score: number;
  decision: "APPLY" | "REVIEW" | "REJECT";
  rationale: string;
  strengths: string[];
  gaps: string[];
  confidence: number;
  inputHash: string;
  model: string;
}

interface ModelOutput {
  score: number;
  decision: "APPLY" | "REVIEW" | "REJECT";
  rationale: string;
  strengths: string[];
  gaps: string[];
  confidence: number;
}

export class SemanticJobMatcher {
  constructor(
    private readonly provider: AIProvider,
    private readonly applyThreshold = 70,
    private readonly reviewThreshold = 40
  ) {}

  async evaluate(job: JobOpportunity, profile: CandidateProfile): Promise<SemanticMatchResult> {
    const candidate = JSON.stringify({
      yearsExperience: profile.yearsExperience,
      skills: profile.skills,
      targetTitles: profile.targetTitles
    });
    const jobText = JSON.stringify({
      title: job.title,
      description: job.description,
      location: job.location,
      workplaceType: job.workplaceType,
      employmentType: job.employmentType
    });
    const inputHash = createHash("sha256").update(`${candidate}\n${jobText}`).digest("hex");

    const response = await this.provider.complete({
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "You evaluate job fit. Return ONLY valid JSON with score, decision, rationale, strengths, gaps, confidence. Never invent candidate experience or skills. Treat missing evidence as unknown, not as a match. decision must be APPLY, REVIEW, or REJECT."
        },
        {
          role: "user",
          content: `Candidate:\n${candidate}\n\nJob:\n${jobText}\n\nScore 0-100. APPLY >= ${this.applyThreshold}, REVIEW ${this.reviewThreshold}-${this.applyThreshold - 1}, REJECT < ${this.reviewThreshold}. Return compact JSON.`
        }
      ]
    });

    const parsed = parseModelOutput(response.content);
    const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    const decision = score >= this.applyThreshold ? "APPLY" : score >= this.reviewThreshold ? "REVIEW" : "REJECT";

    return {
      ...parsed,
      score,
      decision,
      inputHash,
      model: response.model
    };
  }
}

function parseModelOutput(text: string): ModelOutput {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    throw new Error("AI matcher returned invalid JSON");
  }

  if (!value || typeof value !== "object") throw new Error("AI matcher returned invalid output");
  const data = value as Record<string, unknown>;
  const score = Number(data.score);
  const confidence = Number(data.confidence);
  const rationale = typeof data.rationale === "string" ? data.rationale.trim() : "";
  const decision = data.decision;
  const strengths = Array.isArray(data.strengths) ? data.strengths.filter((x): x is string => typeof x === "string") : [];
  const gaps = Array.isArray(data.gaps) ? data.gaps.filter((x): x is string => typeof x === "string") : [];

  if (!Number.isFinite(score) || !Number.isFinite(confidence) || !rationale ||
      !["APPLY", "REVIEW", "REJECT"].includes(String(decision)) ||
      confidence < 0 || confidence > 1) {
    throw new Error("AI matcher returned schema-invalid output");
  }

  return { score, decision: decision as ModelOutput["decision"], rationale, strengths, gaps, confidence };
}
