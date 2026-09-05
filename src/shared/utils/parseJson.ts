import { AppError } from "../errors/AppError";

export function parseJsonObject<T>(content: string): T {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch (error) {
    throw new AppError("AI returned invalid JSON", {
      code: "AI_INVALID_JSON",
      statusCode: 502,
      cause: error
    });
  }
}
