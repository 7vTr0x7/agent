export interface AiGenerateInput {
  system: string;
  prompt: string;
  temperature?: number;
}

export interface AiGenerateResult {
  text: string;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  generate(input: AiGenerateInput): Promise<AiGenerateResult>;
}
