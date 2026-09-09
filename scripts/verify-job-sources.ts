import { loadConfig } from "../src/config/env";
import { parseSourceConfigs } from "../src/discovery/sources/SourceConfig";

interface CheckResult {
  id: string;
  name: string;
  type: string;
  url: string;
  status: "PASS" | "FAIL" | "SKIP";
  httpStatus?: number;
  message: string;
  elapsedMs: number;
}

const TIMEOUT_MS = 15_000;

async function checkSource(source: ReturnType<typeof parseSourceConfigs>[number]): Promise<CheckResult> {
  const url = source.feedUrl ?? source.url ?? source.apiUrl;
  if (!url) {
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      url: "",
      status: "SKIP",
      message: "Composite source has no direct public URL; validated by the discovery smoke run instead",
      elapsedMs: 0
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/json, text/xml, */*",
        "user-agent": "job-agent-discovery-health/1.0"
      }
    });
    const elapsedMs = Date.now() - started;
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (!response.ok) {
      return {
        id: source.id,
        name: source.name,
        type: source.type,
        url,
        status: "FAIL",
        httpStatus: response.status,
        message: `HTTP ${response.status}${response.status === 429 ? " (rate limited)" : response.status === 404 ? " (endpoint not found)" : ""}`,
        elapsedMs
      };
    }
    if (contentLength === 0) {
      const body = await response.text();
      if (!body.trim()) {
        return { id: source.id, name: source.name, type: source.type, url, status: "FAIL", httpStatus: response.status, message: "Empty response body", elapsedMs };
      }
    }
    return { id: source.id, name: source.name, type: source.type, url, status: "PASS", httpStatus: response.status, message: "Public endpoint reachable", elapsedMs };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const message = error instanceof Error && error.name === "AbortError" ? `Timeout after ${TIMEOUT_MS}ms` : error instanceof Error ? error.message : String(error);
    return { id: source.id, name: source.name, type: source.type, url, status: "FAIL", message, elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sources = parseSourceConfigs(config.jobSources);
  const results = await Promise.all(sources.map(checkSource));
  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL").length;
  const skipped = results.filter((result) => result.status === "SKIP").length;
  const checked = passed + failed;

  console.log(JSON.stringify({
    sourceCount: results.length,
    passed,
    failed,
    skipped,
    checkedSources: checked,
    successRate: checked === 0 ? 0 : Number(((passed / checked) * 100).toFixed(1)),
    results
  }, null, 2));

  if (failed > 0) process.exitCode = 1;
}

void main();
