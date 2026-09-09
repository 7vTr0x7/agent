import { promises as dns } from "node:dns";
import { PublicRecruiterSearchProvider, isPlausibleRecruiterEmail } from "./PublicRecruiterSearchProvider";

describe("PublicRecruiterSearchProvider", () => {
  it("rejects search-engine artifacts and malformed recruiter addresses", () => {
    expect(isPlausibleRecruiterEmail("22@accenture.com")).toBe(false);
    expect(isPlausibleRecruiterEmail("%22accenture%22%20@accenture.com")).toBe(false);
    expect(isPlausibleRecruiterEmail(".recruiter@accenture.com")).toBe(false);
    expect(isPlausibleRecruiterEmail("recruiter..name@accenture.com")).toBe(false);
    expect(isPlausibleRecruiterEmail("keri.williams@accenture.com")).toBe(true);
  });

  it("accepts an explicitly recruiting mailbox even when the search snippet omits recruiting keywords", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("dns")) return new Response(JSON.stringify({ Answer: [] }), { status: 200 });
      return new Response("Acme Corp careers result: recruiting@acme.com", { status: 200 });
    }) as typeof fetch;

    try {
      const provider = new PublicRecruiterSearchProvider();
      const result = await provider.discover({
        companyName: "Acme Corp",
        companyDomain: "acme.com",
        jobTitle: "Frontend Developer",
        jobDescription: "",
        candidateProfileId: "candidate-1"
      });
      expect(result.contacts.map((contact) => contact.email)).toContain("recruiting@acme.com");
      expect(result.contacts[0]?.confidence).toBeGreaterThanOrEqual(94);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("marks a recruiter email as domain_mx_verified when the employer domain has MX records", async () => {
    const resolveMx = jest.spyOn(dns, "resolveMx").mockResolvedValue([
      { exchange: "mail.accenture.com", priority: 10 }
    ]);
    try {
      const provider = new PublicRecruiterSearchProvider();
      await expect(provider.verify("keri.williams@accenture.com")).resolves.toEqual({
        email: "keri.williams@accenture.com",
        verified: true,
        status: "domain_mx_verified",
        confidence: 75
      });
      expect(resolveMx).toHaveBeenCalledWith("accenture.com");
    } finally {
      resolveMx.mockRestore();
    }
  });

  it("does not mark an address verified when the employer domain has no MX records", async () => {
    const resolveMx = jest.spyOn(dns, "resolveMx").mockResolvedValue([]);
    try {
      const provider = new PublicRecruiterSearchProvider();
      await expect(provider.verify("recruiter@example.com")).resolves.toEqual({
        email: "recruiter@example.com",
        verified: false,
        status: "no_mx_record",
        confidence: 0
      });
    } finally {
      resolveMx.mockRestore();
    }
  });

  it("falls back to DNS-over-HTTPS when the local resolver fails", async () => {
    const resolveMx = jest.spyOn(dns, "resolveMx").mockRejectedValue(new Error("EAI_AGAIN"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cloudflare-dns.com")) {
        return new Response(JSON.stringify({ Answer: [{ type: 15, data: "10 mail.example.com." }] }), {
          status: 200,
          headers: { "content-type": "application/dns-json" }
        });
      }
      return new Response(JSON.stringify({ Answer: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      const provider = new PublicRecruiterSearchProvider();
      await expect(provider.verify("recruiter@example.com")).resolves.toEqual({
        email: "recruiter@example.com",
        verified: true,
        status: "domain_mx_verified_doh",
        confidence: 75
      });
    } finally {
      resolveMx.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it("does not claim mailbox-level verification", async () => {
    const resolveMx = jest.spyOn(dns, "resolveMx").mockResolvedValue([
      { exchange: "mail.example.com", priority: 10 }
    ]);
    try {
      const provider = new PublicRecruiterSearchProvider();
      const result = await provider.verify("recruiter@example.com");
      expect(result.status).toBe("domain_mx_verified");
      expect(result.verified).toBe(true);
      expect(result.status).not.toBe("mailbox_verified");
    } finally {
      resolveMx.mockRestore();
    }
  });
});
