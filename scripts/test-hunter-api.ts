import "dotenv/config";

const HUNTER_API_BASE = "https://api.hunter.io/v2";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const domain = (process.env.RECRUITER_TEST_COMPANY_DOMAIN?.trim() || "intercom.com")
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/^www\./, "");
  const apiKey = required("HUNTER_API_KEY");

  const searchUrl = new URL(`${HUNTER_API_BASE}/domain-search`);
  searchUrl.searchParams.set("domain", domain);
  searchUrl.searchParams.set("api_key", apiKey);
  searchUrl.searchParams.set("limit", "1");

  const searchResponse = await fetch(searchUrl, { headers: { Accept: "application/json" } });
  const searchPayload = (await searchResponse.json()) as {
    data?: { domain?: string; emails?: unknown[] };
    errors?: unknown;
  };

  if (!searchResponse.ok) {
    throw new Error(`Hunter Domain Search failed with HTTP ${searchResponse.status}`);
  }

  console.log(JSON.stringify({
    connectivity: "PASS",
    testKey: apiKey === "test-api-key",
    endpoint: "domain-search",
    requestedDomain: domain,
    returnedDomain: searchPayload.data?.domain ?? null,
    returnedEmailCount: searchPayload.data?.emails?.length ?? 0,
    note: apiKey === "test-api-key"
      ? "Hunter's documented test key validates the request and returns dummy data; it does not perform real recruiter discovery."
      : "Production API key accepted. Use npm run dry-run:recruiters for real recruiter discovery."
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
