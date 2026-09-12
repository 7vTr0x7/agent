import { spawn } from "node:child_process";
import { join } from "node:path";

describe("Phase 9 browser fixture lifecycle", () => {
  jest.setTimeout(180_000);

  function runFixture(): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
      const script = join(process.cwd(), "scripts", "phase9-application-runtime.ts");
      const child = spawn(tsx, [script], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "test",
          APPLICATION_DRY_RUN: "true",
          AUTOMATION_ENABLED: "false",
          GMAIL_ENABLED: "false",
          OUTBOUND_ENABLED: "false",
          PROACTIVE_RECRUITER_ENABLED: "false",
          PROACTIVE_RECRUITER_SEND_ENABLED: "false",
          STALE_SUBMISSION_RECONCILIATION_ENABLED: "false",
          RECRUITER_REQUIRE_VERIFIED_EMAIL: "true"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      const deadline = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
        reject(new Error(`Phase 9 fixture did not exit within 60 seconds.\nstdout=${stdout}\nstderr=${stderr}`));
      }, 60_000);

      child.once("error", (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(deadline);
        resolve({ code, signal, stdout, stderr });
      });
    });
  }

  it("terminates cleanly twice without leaving browser/server lifecycle resources", async () => {
    for (let run = 1; run <= 2; run += 1) {
      const result = await runFixture();
      if (result.signal !== null || result.code !== 0) {
        throw new Error(`Phase 9 fixture run ${run} exited unexpectedly. code=${result.code} signal=${result.signal}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
      }
      expect(result.stdout).toContain('"status":"ok"');
      expect(result.stdout).toContain('"realApplicationsSubmitted":0');
      expect(result.stdout).toContain('"activeBrowserSessionsBeforeCleanup":0');
      expect(result.stderr).not.toContain("Phase 9 fixture terminating:");
    }
  });
});
