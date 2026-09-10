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
      expect(result.contacts[0]?.verified).toBe(false);
      expect(result.contacts[0]?.discoveryEvidence?.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("marks an MX-backed recruiter email as LIKELY, not mailbox VERIFIED", async () => {
    const resolveMx = jest.spyOn(dns, "resolveMx").mockResolvedValue([
      { exchange: "mail.accenture.com", priority: 10 }
    ]);
    try {
      const provider = new PublicRecruiterSearchProvider();
      await expect(provider.verify("keri.williams@accenture.com")).resolves.toEqual({
        email: "keri.williams@accenture.com",
        verified: false,
        status: "LIKELY",
        confidence: 75
      });
      expect(resolveMx).toHaveBeenCalledWith("accenture.com");
    } finally {
      resolveMx.mockRestore();
    }
  });

  it("marks an address INVALID when the employer domain has no MX records", async () => {
    const resolveMx = jest.spyOn(dns, "resolveMx").mockResolvedValue([]);
    try {
      const provider = new PublicRecruiterSearchProvider();
      await expect(provider.verify("recruiter@example.com")).resolves.toEqual({
        email: "recruiter@example.com",
        verified: false,
        status: "INVALID",
        confidence: 0
      });
    } finally {
      resolveMx.mockRestore();
    }
  });

  it("falls back to DNS-over-HTTPS without upgrading MX evidence to mailbox verification", async () => {
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
        verified: false,
        status: "LIKELY",
        confidence: 75
      });
    } finally {
      resolveMx.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it("does not claim mailbox-level verification from MX evidence alone", async () => {
    const resolveMx = jest.spyOn(dns, "resolveMx").mockResolvedValue([
      { exchange: "mail.example.com", priority: 10 }
    ]);
    try {
      const provider = new PublicRecruiterSearchProvider();
      const result = await provider.verify("recruiter@example.com");
      expect(result.status).toBe("LIKELY");
      expect(result.verified).toBe(false);
      expect(result.status).not.toBe("VERIFIED");
      expect(result.status).not.toBe("mailbox_verified");
    } finally {
      resolveMx.mockRestore();
    }
  });
});
