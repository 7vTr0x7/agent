#!/usr/bin/env bash
set -euo pipefail

mkdir -p \
  src/config \
  src/shared/errors \
  src/shared/types \
  src/shared/utils \
  src/ai \
  src/database \
  src/jobs \
  src/applications \
  src/emails \
  src/recruiters \
  src/resumes \
  src/scheduler \
  tests

cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
EOF

cat > .gitignore <<'EOF'
node_modules/
dist/
.env
.env.*
!.env.example
coverage/
*.log
.DS_Store
EOF

cat > .env.example <<'EOF'
NODE_ENV=development
LOG_LEVEL=info

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b
OLLAMA_TIMEOUT_MS=120000

DATABASE_URL=postgresql://job_agent:job_agent@localhost:5432/job_agent
EOF

cat > src/config/env.ts <<'EOF'
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

export function loadConfig(): AppConfig {
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
    databaseUrl: required("DATABASE_URL", process.env.DATABASE_URL)
  };
}
EOF

cat > src/shared/errors/AppError.ts <<'EOF'
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly cause?: unknown;

  constructor(
    message: string,
    options: {
      code?: string;
      statusCode?: number;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "AppError";
    this.code = options.code ?? "APP_ERROR";
    this.statusCode = options.statusCode ?? 500;
    this.cause = options.cause;
  }
}
EOF

cat > src/shared/types/ai.ts <<'EOF'
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
EOF

cat > src/shared/types/job.ts <<'EOF'
export type JobDecision = "APPLY" | "REJECT" | "REVIEW";

export interface JobMatchResult {
  matchScore: number;
  decision: JobDecision;
  reason: string;
}
EOF

cat > src/shared/utils/parseJson.ts <<'EOF'
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
EOF

cat > src/ai/OllamaProvider.ts <<'EOF'
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
EOF

cat > src/ai/JobMatcher.ts <<'EOF'
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
EOF

cat > src/database/Database.ts <<'EOF'
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export class Database {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000
    });
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = []
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }

  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
EOF

cat > src/index.ts <<'EOF'
import pino from "pino";
import { loadConfig } from "./config/env";
import { OllamaProvider } from "./ai/OllamaProvider";
import { JobMatcher } from "./ai/JobMatcher";

const config = loadConfig();

const logger = pino({
  level: config.logLevel
});

async function main(): Promise<void> {
  const ollama = new OllamaProvider(
    config.ollama.baseUrl,
    config.ollama.model,
    config.ollama.timeoutMs
  );

  const matcher = new JobMatcher(ollama);

  logger.info(
    {
      nodeEnv: config.nodeEnv,
      ollamaModel: config.ollama.model,
      ollamaBaseUrl: config.ollama.baseUrl
    },
    "job-agent started"
  );

  const result = await matcher.evaluate(
    "Frontend Engineer with React, Next.js, TypeScript, Redux Toolkit, Node.js and 3 years of experience.",
    "We are looking for a Frontend Developer with React and TypeScript experience."
  );

  logger.info({ result }, "AI job-match test completed");
}

main().catch((error: unknown) => {
  logger.error({ error }, "job-agent failed to start");
  process.exitCode = 1;
});
EOF

cat > .env <<'EOF'
NODE_ENV=development
LOG_LEVEL=info

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b
OLLAMA_TIMEOUT_MS=120000

DATABASE_URL=postgresql://job_agent:job_agent@localhost:5432/job_agent
EOF

npm run typecheck

rm setup-foundation.sh

echo
echo "=== FOUNDATION CREATED ==="
echo
find src -maxdepth 3 -type f | sort
