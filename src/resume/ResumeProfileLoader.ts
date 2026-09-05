import { readFile } from "node:fs/promises";
import { ResumeProfile } from "./ResumeProfile";

export class ResumeProfileLoader {
  async load(path: string): Promise<ResumeProfile> {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Resume profile must be a JSON object.");
    }

    const resume = parsed as Partial<ResumeProfile>;
    if (!resume.name || !resume.summary || !Array.isArray(resume.skills) || !Array.isArray(resume.experience) || !Array.isArray(resume.education)) {
      throw new Error("Resume profile must contain name, summary, skills, experience and education.");
    }

    return resume as ResumeProfile;
  }
}
