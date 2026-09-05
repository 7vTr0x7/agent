import { ResumeArtifactRenderer } from "./ResumeArtifactRenderer";
import { ResumeProfileLoader } from "./ResumeProfileLoader";
import { ResumeTailoringService } from "./ResumeTailoringService";

export interface TailoredResumeArtifact {
  resumePath: string;
  sourceVersion: string;
  atsScore: number;
  matchedKeywords: readonly string[];
  missingKeywords: readonly string[];
  warnings: readonly string[];
}

export class TailoredResumeArtifactService {
  constructor(
    private readonly loader: ResumeProfileLoader,
    private readonly tailoring: ResumeTailoringService,
    private readonly renderer: ResumeArtifactRenderer,
    private readonly masterPath: string,
    private readonly sourceVersion = "master-resume"
  ) {}

  async create(jobTitle: string, jobDescription: string): Promise<TailoredResumeArtifact> {
    const master = await this.loader.load(this.masterPath);
    const tailored = this.tailoring.tailor({
      resume: master,
      jobTitle,
      jobDescription,
      sourceVersion: this.sourceVersion
    });
    const resumePath = await this.renderer.renderPdf(tailored, master.name);

    return {
      resumePath,
      sourceVersion: tailored.sourceVersion,
      atsScore: tailored.atsScore,
      matchedKeywords: tailored.matchedKeywords,
      missingKeywords: tailored.missingKeywords,
      warnings: tailored.warnings
    };
  }
}
