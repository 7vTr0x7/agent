import { AppError } from "../shared/errors/AppError";
import {
  AICompletionRequest,
  AICompletionResponse,
  AIProvider
} from "../shared/types/ai";

interface OllamaChatResponse {
  model: string;
  message?: {
    role: string;
    content?: string;
  };
}

export class OllamaProvider implements AIProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs: number
  ) {}

  async complete(
    request: AICompletionRequest
  ): Promise<AICompletionResponse> {
    const startedAt = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.timeoutMs
    );

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: request.messages,
          options: {
            temperature: request.temperature ?? 0
          }
        })
      });

      if (!response.ok) {
        const body = await response.text();

        throw new AppError(`Ollama request failed: ${response.status}`, {
          code: "AI_PROVIDER_ERROR",
          statusCode: 502,
          cause: body
        });
      }

      const data = (await response.json()) as OllamaChatResponse;
      const content = data.message?.content;

      if (!content) {
        throw new AppError("Ollama returned an empty response", {
          code: "AI_EMPTY_RESPONSE",
          statusCode: 502
        });
      }

      return {
        content,
        model: data.model,
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AppError("Ollama request timed out", {
          code: "AI_TIMEOUT",
          statusCode: 504,
          cause: error
        });
      }

      throw new AppError("Unable to communicate with Ollama", {
        code: "AI_CONNECTION_ERROR",
        statusCode: 502,
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
