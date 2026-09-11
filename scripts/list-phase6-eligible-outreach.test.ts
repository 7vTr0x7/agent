import fs from "node:fs";
import path from "node:path";

describe("Phase 6 eligibility listing contract", () => {
  it("uses the canonical real-send predicate instead of raw verified=true", () => {
    const scriptPath = path.resolve(__dirname, "list-phase6-eligible-outreach.ts");
    const source = fs.readFileSync(scriptPath, "utf8");
    expect(source).toContain("recruiterRealSendEligibilitySql(\"c\")");
    expect(source).toContain("AND (${eligibility})");
    expect(source).not.toContain("AND c.verified=true");
    expect(source).not.toContain("AND c.verified = true");
  });

  it("does not define an independent verification-status shortcut", () => {
    const scriptPath = path.resolve(__dirname, "list-phase6-eligible-outreach.ts");
    const source = fs.readFileSync(scriptPath, "utf8");
    expect(source).not.toMatch(/verification_status\s*=\s*['\"](verified|VERIFIED|valid)['\"]/i);
    expect(source).not.toMatch(/email_status\s*=\s*['\"]VERIFIED['\"]/i);
  });
});
