import { OllamaProvider } from "./OllamaProvider";
import { parseJsonObject } from "../shared/utils/parseJson";
import { JobMatchResult, JobDecision } from "../shared/types/job";
import { AppError } from "../shared/errors/AppError";

interface RawJobMatchResult {
  matchScore: number;
  decision: string;
  reason: string;
}

export class JobMatcher {
  constructor(private readonly ai: OllamaProvider) {}

  async evaluate(
    profile: string,
    jobDescription: string
  ): Promise<JobMatchResult> {
    const response = await this.ai.complete({
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You evaluate job fit. Return ONLY one compact JSON object with exactly these fields: matchScore (integer 0-100), decision (APPLY, REJECT, or REVIEW), reason (short string). Do not use markdown."
        },
        {
          role: "user",
          content: `Candidate profile:
${profile}

Job description:
${jobDescription}`
        }
      ]
    });

    const result = parseJsonObject<RawJobMatchResult>(response.content);

    if (
      !Number.isInteger(result.matchScore) ||
      result.matchScore < 0 ||
      result.matchScore > 100
    ) {
      throw new AppError("AI returned an invalid match score", {
        code: "AI_INVALID_MATCH_SCORE",
        statusCode: 502
      });
    }

    if (!["APPLY", "REJECT", "REVIEW"].includes(result.decision)) {
      throw new AppError("AI returned an invalid job decision", {
        code: "AI_INVALID_DECISION",
        statusCode: 502
      });
    }

    if (!result.reason || typeof result.reason !== "string") {
      throw new AppError("AI returned an invalid match reason", {
        code: "AI_INVALID_REASON",
        statusCode: 502
      });
    }

    return {
      matchScore: result.matchScore,
      decision: result.decision as JobDecision,
      reason: result.reason
    };
  }
}
