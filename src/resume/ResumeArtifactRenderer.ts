import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { TailoredResume } from "./ResumeProfile";

export interface ResumeArtifactRendererOptions {
  outputDirectory: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "resume";
}

export class ResumeArtifactRenderer {
  constructor(private readonly options: ResumeArtifactRendererOptions) {}

  async renderPdf(resume: TailoredResume, name: string): Promise<string> {
    await mkdir(this.options.outputDirectory, { recursive: true });
    const outputPath = join(
      this.options.outputDirectory,
      `${safeFilePart(name)}-${safeFilePart(resume.jobTitle)}-${Date.now()}.pdf`
    );

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(this.toHtml(resume, name), { waitUntil: "load" });
      await page.pdf({
        path: outputPath,
        format: "A4",
        printBackground: false,
        margin: { top: "16mm", right: "16mm", bottom: "16mm", left: "16mm" }
      });
    } finally {
      await browser.close();
    }

    return outputPath;
  }

  private toHtml(resume: TailoredResume, name: string): string {
    const experience = resume.experience.map((item) => `
      <section>
        <h3>${escapeHtml(item.title)} — ${escapeHtml(item.company)}</h3>
        <p class="meta">${escapeHtml(item.startDate)}${item.endDate ? ` – ${escapeHtml(item.endDate)}` : ""}${item.location ? ` · ${escapeHtml(item.location)}` : ""}</p>
        <ul>${item.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>
      </section>
    `).join("");

    const education = resume.education.map((item) => `
      <section>
        <h3>${escapeHtml(item.degree)}${item.field ? `, ${escapeHtml(item.field)}` : ""}</h3>
        <p class="meta">${escapeHtml(item.institution)}${item.endDate ? ` · ${escapeHtml(item.endDate)}` : ""}</p>
        ${(item.details ?? []).map((detail) => `<p>${escapeHtml(detail)}</p>`).join("")}
      </section>
    `).join("");

    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.35; color: #111; }
h1 { font-size: 20pt; margin: 0 0 4pt; }
h2 { font-size: 11pt; border-bottom: 1px solid #333; padding-bottom: 2pt; margin: 12pt 0 5pt; text-transform: uppercase; }
h3 { font-size: 10.5pt; margin: 5pt 0 1pt; }
p { margin: 3pt 0; }
.meta { color: #444; font-size: 9pt; }
ul { margin: 3pt 0 5pt 16pt; padding: 0; }
li { margin: 2pt 0; }
.skills { margin: 0; }
</style></head><body>
<h1>${escapeHtml(name)}</h1>
<p>${escapeHtml(resume.summary)}</p>
<h2>Skills</h2><p class="skills">${resume.skills.map(escapeHtml).join(" · ")}</p>
<h2>Experience</h2>${experience}
<h2>Education</h2>${education}
</body></html>`;
  }
}
