import "dotenv/config";

export interface AppConfig {
  nodeEnv: string;
  logLevel: string;
  ollama: {
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
  databaseUrl: string;
  email: {
    enabled: boolean;
    provider: "resend";
    apiKey: string | null;
    from: string | null;
  };
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function positiveInteger(name: string, value: string | undefined): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function booleanValue(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(): AppConfig {
  const emailEnabled = booleanValue(
    "EMAIL_ENABLED",
    process.env.EMAIL_ENABLED,
    false
  );

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    logLevel: process.env.LOG_LEVEL ?? "info",
    ollama: {
      baseUrl: (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/+$/, ""),
      model: process.env.OLLAMA_MODEL ?? "qwen3:8b",
      timeoutMs: positiveInteger(
        "OLLAMA_TIMEOUT_MS",
        process.env.OLLAMA_TIMEOUT_MS ?? "120000"
      )
    },
    databaseUrl: required("DATABASE_URL", process.env.DATABASE_URL),
    email: {
      enabled: emailEnabled,
      provider: "resend",
      apiKey: emailEnabled ? required("RESEND_API_KEY", process.env.RESEND_API_KEY) : null,
      from: emailEnabled ? required("EMAIL_FROM", process.env.EMAIL_FROM) : null
    }
  };
}
