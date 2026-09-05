import { SourceStatus, SourceType } from "../policy/SourcePolicy";

export interface SourceConfig {
  readonly id: string;
  readonly type: SourceType;
  readonly name: string;
  readonly status?: SourceStatus;
  readonly boardToken?: string;
  readonly boardName?: string;
}

export function parseSourceConfigs(value: string | undefined): SourceConfig[] {
  if (!value?.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("JOB_SOURCES must contain valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("JOB_SOURCES must be a JSON array");
  }

  return parsed.map((item, index) => validateSourceConfig(item, index));
}

function validateSourceConfig(value: unknown, index: number): SourceConfig {
  if (!value || typeof value !== "object") {
    throw new Error(`JOB_SOURCES[${index}] must be an object`);
  }

  const item = value as Record<string, unknown>;
  const id = stringField(item.id, `JOB_SOURCES[${index}].id`);
  const name = stringField(item.name, `JOB_SOURCES[${index}].name`);
  const type = stringField(item.type, `JOB_SOURCES[${index}].type`) as SourceType;

  if (!["api", "rss", "ats", "structured-data", "web"].includes(type)) {
    throw new Error(`JOB_SOURCES[${index}].type is invalid`);
  }

  const status = item.status === undefined ? undefined : stringField(item.status, `JOB_SOURCES[${index}].status`) as SourceStatus;
  if (status !== undefined && !["APPROVED", "REVIEW_REQUIRED", "DISABLED"].includes(status)) {
    throw new Error(`JOB_SOURCES[${index}].status is invalid`);
  }

  const boardToken = optionalString(item.boardToken, `JOB_SOURCES[${index}].boardToken`);
  const boardName = optionalString(item.boardName, `JOB_SOURCES[${index}].boardName`);

  return { id, type, name, status, boardToken, boardName };
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return stringField(value, field);
}
