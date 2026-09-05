export interface AICompletionRequest {
  prompt: string;
  temperature?: number;
}

export interface AICompletionResult {
  text: string;
  model: string;
  provider: string;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  complete(request: AICompletionRequest): Promise<AICompletionResult>;
}
