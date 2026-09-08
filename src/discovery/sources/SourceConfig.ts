import { SourceStatus, SourceType } from "../policy/SourcePolicy";

export interface SourceConfig {
  readonly id: string;
  readonly type: SourceType;
  readonly name: string;
  readonly status?: SourceStatus;
  readonly boardToken?: string;
  readonly boardName?: string;
  readonly feedUrl?: string;
  readonly url?: string;
  readonly companyDomain?: string;
  readonly apiUrl?: string;
  readonly apiKeyEnv?: string;
  readonly portals?: readonly string[];
  readonly countryCode?: string;
  readonly city?: string;
  readonly workPlace?: string;
  readonly query?: string;
  readonly queries?: readonly string[];
  readonly locations?: readonly string[];
  readonly pages?: number;
  readonly resultsPerPage?: number;
  readonly resultOnPage?: number;
}

export function parseSourceConfigs(value: string | undefined): SourceConfig[] {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("JOB_SOURCES must contain valid JSON"); }
  if (!Array.isArray(parsed)) throw new Error("JOB_SOURCES must be a JSON array");
  const configs = parsed.map((item, index) => validateSourceConfig(item, index));
  const ids = new Set<string>();
  for (const config of configs) { if (ids.has(config.id)) throw new Error(`JOB_SOURCES contains duplicate id: ${config.id}`); ids.add(config.id); }
  return configs;
}

function validateSourceConfig(value: unknown, index: number): SourceConfig {
  if (!value || typeof value !== "object") throw new Error(`JOB_SOURCES[${index}] must be an object`);
  const item = value as Record<string, unknown>;
  const id = stringField(item.id, `JOB_SOURCES[${index}].id`);
  const name = stringField(item.name, `JOB_SOURCES[${index}].name`);
  const type = stringField(item.type, `JOB_SOURCES[${index}].type`) as SourceType;
  if (!["api", "rss", "ats", "structured-data", "web"].includes(type)) throw new Error(`JOB_SOURCES[${index}].type is invalid`);
  const status = item.status === undefined ? undefined : stringField(item.status, `JOB_SOURCES[${index}].status`) as SourceStatus;
  if (status !== undefined && !["APPROVED", "REVIEW_REQUIRED", "DISABLED"].includes(status)) throw new Error(`JOB_SOURCES[${index}].status is invalid`);

  const config: SourceConfig = {
    id, name, type, status,
    boardToken: optionalString(item.boardToken, `JOB_SOURCES[${index}].boardToken`),
    boardName: optionalString(item.boardName, `JOB_SOURCES[${index}].boardName`),
    feedUrl: optionalString(item.feedUrl, `JOB_SOURCES[${index}].feedUrl`),
    url: optionalString(item.url, `JOB_SOURCES[${index}].url`),
    companyDomain: optionalString(item.companyDomain, `JOB_SOURCES[${index}].companyDomain`),
    apiUrl: optionalString(item.apiUrl, `JOB_SOURCES[${index}].apiUrl`),
    apiKeyEnv: optionalString(item.apiKeyEnv, `JOB_SOURCES[${index}].apiKeyEnv`),
    portals: stringArray(item.portals, `JOB_SOURCES[${index}].portals`),
    countryCode: optionalString(item.countryCode, `JOB_SOURCES[${index}].countryCode`),
    city: optionalString(item.city, `JOB_SOURCES[${index}].city`),
    workPlace: optionalString(item.workPlace, `JOB_SOURCES[${index}].workPlace`),
    query: optionalString(item.query, `JOB_SOURCES[${index}].query`),
    queries: stringArray(item.queries, `JOB_SOURCES[${index}].queries`),
    locations: stringArray(item.locations, `JOB_SOURCES[${index}].locations`),
    pages: optionalPositiveInteger(item.pages, `JOB_SOURCES[${index}].pages`),
    resultsPerPage: optionalPositiveInteger(item.resultsPerPage, `JOB_SOURCES[${index}].resultsPerPage`),
    resultOnPage: optionalPositiveInteger(item.resultOnPage, `JOB_SOURCES[${index}].resultOnPage`)
  };

  if ((type === "web" || type === "structured-data") && !config.url) throw new Error(`JOB_SOURCES[${index}].url is required for ${type} sources`);
  return config;
}

function stringField(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`); return value.trim(); }
function optionalString(value: unknown, field: string): string | undefined { if (value === undefined || value === null) return undefined; return stringField(value, field); }
function stringArray(value: unknown, field: string): readonly string[] | undefined { if (value === undefined || value === null) return undefined; if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings`); return value.map((item) => stringField(item, `${field}[]`)); }
function optionalPositiveInteger(value: unknown, field: string): number | undefined { if (value === undefined || value === null) return undefined; if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${field} must be a positive integer`); return Number(value); }
