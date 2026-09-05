import { AppError } from "../../shared/errors/AppError";
import {
  AICompletionRequest,
  AICompletionResponse,
  AIProvider
} from "../../shared/types/ai";

interface OllamaResponse {
  message?: { content?: string };
  model?: string;
  error?: string;
}

export class OllamaProvider implements AIProvider {
  constructor(
    private readonly model: string,
    private readonly baseUrl = "http://localhost:11434",
    private readonly timeoutMs = 120000
  ) {}

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages,
          stream: false,
          options: {
            temperature: request.temperature ?? 0,
            ...(request.maxTokens ? { num_predict: request.maxTokens } : {})
          }
        }),
        signal: controller.signal
      });

      const body = (await response.json()) as OllamaResponse;

      if (!response.ok) {
        throw new AppError(
          `Ollama request failed: ${body.error ?? response.status}`,
          {
            code: "AI_PROVIDER_REQUEST_FAILED",
            statusCode: response.status
          }
        );
      }

      const content = body.message?.content;
      if (typeof content !== "string") {
        throw new AppError("Ollama returned an invalid completion", {
          code: "AI_PROVIDER_INVALID_RESPONSE",
          statusCode: 502
        });
      }

      return {
        content: content.trim(),
        model: body.model ?? this.model,
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("Ollama request timed out", {
          code: "AI_PROVIDER_TIMEOUT",
          statusCode: 504,
          cause: error
        });
      }
      throw new AppError("Ollama request failed", {
        code: "AI_PROVIDER_UNAVAILABLE",
        statusCode: 503,
        cause: error
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
