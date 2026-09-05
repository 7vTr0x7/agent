import { AppError } from "../../shared/errors/AppError";
import { AICompletionRequest, AICompletionResult, AIProvider } from "./AIProvider";

interface OllamaResponse { response?: string; model?: string; error?: string; }

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  constructor(public readonly model: string, private readonly baseUrl = "http://localhost:11434", private readonly timeoutMs = 120000) {}

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/api/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: request.prompt, stream: false, options: { temperature: request.temperature ?? 0 } }),
        signal: controller.signal
      });
      const body = (await response.json()) as OllamaResponse;
      if (!response.ok) throw new AppError(`Ollama request failed: ${body.error ?? response.status}`, { code: "AI_PROVIDER_REQUEST_FAILED", statusCode: response.status });
      if (typeof body.response !== "string") throw new AppError("Ollama returned an invalid completion", { code: "AI_PROVIDER_INVALID_RESPONSE", statusCode: 502 });
      return { text: body.response.trim(), model: body.model ?? this.model, provider: this.name };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new AppError("Ollama request timed out", { code: "AI_PROVIDER_TIMEOUT", statusCode: 504, cause: error });
      throw new AppError("Ollama request failed", { code: "AI_PROVIDER_UNAVAILABLE", statusCode: 503, cause: error });
    } finally { clearTimeout(timer); }
  }
}
