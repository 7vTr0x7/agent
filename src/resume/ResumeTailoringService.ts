import { ResumeProfile, TailoredResume } from "./ResumeProfile";

const STOP_WORDS = new Set([
  "and", "the", "with", "for", "from", "that", "this", "are", "you", "your",
  "our", "their", "have", "has", "will", "into", "using", "use", "about", "years",
  "experience", "work", "role", "job", "team", "teams", "required", "preferred",
  "responsibilities", "requirements", "skills", "ability", "strong", "good", "must",
  "should", "candidate", "developer", "engineer"
]);

export interface ResumeTailoringRequest {
  resume: ResumeProfile;
  jobTitle: string;
  jobDescription: string;
  sourceVersion: string;
}

export interface ResumeTailoringResult extends TailoredResume {}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function keywordCandidates(jobTitle: string, description: string, resumeSkills: readonly string[]): string[] {
  const normalizedJobText = normalize(`${jobTitle} ${description}`);
  const titleTokens = tokens(jobTitle);
  const descriptionTokens = tokens(description);
  const counts = new Map<string, number>();

  for (const token of [...titleTokens, ...descriptionTokens]) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  // Preserve meaningful multi-word skills such as "React Testing Library" or
  // "React Native" instead of reducing every requirement to single tokens.
  for (const skill of resumeSkills) {
    const normalizedSkill = normalize(skill);
    if (normalizedSkill.includes(" ") && normalizedJobText.includes(normalizedSkill)) {
      counts.set(normalizedSkill, (counts.get(normalizedSkill) ?? 0) + 2);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token]) => token);
}

function resumeCorpus(resume: ResumeProfile): string {
  return normalize([
    resume.summary,
    ...resume.skills,
    ...resume.experience.flatMap((experience) => [
      experience.company,
      experience.title,
      ...experience.bullets
    ]),
    ...resume.education.flatMap((education) => [
      education.institution,
      education.degree,
      education.field ?? "",
      ...(education.details ?? [])
    ])
  ].join(" "));
}

function containsKeyword(corpus: string, keyword: string): boolean {
  const normalizedCorpus = ` ${normalize(corpus)} `;
  const normalizedKeyword = normalize(keyword);
  return normalizedCorpus.includes(` ${normalizedKeyword} `);
}

function selectExperience(resume: ResumeProfile, matchedKeywords: readonly string[]): ResumeProfile["experience"] {
  const ranked = resume.experience.map((experience, index) => {
    const corpus = normalize([experience.title, ...experience.bullets].join(" "));
    const score = matchedKeywords.reduce((total, keyword) => total + (containsKeyword(corpus, keyword) ? 1 : 0), 0);
    return { experience, index, score };
  });

  return ranked
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ experience }) => ({
      ...experience,
      bullets: [...experience.bullets]
        .sort((a, b) => {
          const aScore = matchedKeywords.reduce((total, keyword) => total + (containsKeyword(a, keyword) ? 1 : 0), 0);
          const bScore = matchedKeywords.reduce((total, keyword) => total + (containsKeyword(b, keyword) ? 1 : 0), 0);
          return bScore - aScore;
        })
        .slice(0, 6)
    }));
}

export class ResumeTailoringService {
  tailor(request: ResumeTailoringRequest): ResumeTailoringResult {
    const jobText = normalize(`${request.jobTitle} ${request.jobDescription}`);
    const candidates = keywordCandidates(request.jobTitle, request.jobDescription, request.resume.skills);
    const corpus = ` ${resumeCorpus(request.resume)} `;
    const matchedKeywords = unique(candidates.filter((keyword) => containsKeyword(corpus, keyword))).slice(0, 40);
    const missingKeywords = unique(candidates.filter((keyword) => !containsKeyword(corpus, keyword))).slice(0, 20);
    const experience = selectExperience(request.resume, matchedKeywords);
    const relevantSkills = request.resume.skills
      .map((skill, index) => ({
        skill,
        index,
        score: matchedKeywords.filter((keyword) => containsKeyword(skill, keyword)).length
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ skill }) => skill);

    const title = normalize(request.jobTitle);
    const titleMatch = containsKeyword(request.resume.summary, title)
      || request.resume.experience.some((item) => normalize(item.title) === title);
    const keywordCoverage = candidates.length === 0 ? 0 : matchedKeywords.length / Math.min(candidates.length, 40);
    const matchedSkills = request.resume.skills.filter((skill) => jobText.includes(normalize(skill)));
    const skillsCoverage = request.resume.skills.length === 0
      ? 0
      : matchedSkills.length / request.resume.skills.length;
    const atsScore = Math.round(Math.min(100, 55 + keywordCoverage * 30 + skillsCoverage * 10 + (titleMatch ? 5 : 0)));

    const warnings: string[] = [];
    if (missingKeywords.length > 0) {
      warnings.push("Missing job keywords were not invented or added because they were not supported by the master resume.");
    }
    if (!titleMatch) {
      warnings.push("The target title is not already supported by the master resume; title wording was not fabricated.");
    }

    return {
      jobTitle: request.jobTitle,
      sourceVersion: request.sourceVersion,
      summary: request.resume.summary,
      skills: relevantSkills,
      experience,
      education: request.resume.education,
      atsScore,
      matchedKeywords,
      missingKeywords,
      warnings
    };
  }
}
