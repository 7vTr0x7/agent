export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICompletionRequest {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AICompletionResponse {
  content: string;
  model: string;
  durationMs: number;
}

export interface AIProvider {
  complete(request: AICompletionRequest): Promise<AICompletionResponse>;
}
