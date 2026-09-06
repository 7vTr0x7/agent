import { RecruiterContactCandidate } from "./RecruiterDiscovery";

const TITLE_WEIGHTS: Array<[RegExp, number]> = [
  [/technical\s+recruiter/i, 100],
  [/engineering\s+recruiter/i, 98],
  [/talent\s+acquisition\s+partner/i, 94],
  [/technical\s+talent/i, 92],
  [/recruiter/i, 85],
  [/talent\s+acquisition/i, 80],
  [/hiring\s+manager/i, 76],
  [/human\s+resources|\bhr\b/i, 55]
];

export interface RankedRecruiterContact extends RecruiterContactCandidate {
  score: number;
  reasons: string[];
}

export function rankRecruiterContacts(
  contacts: RecruiterContactCandidate[],
  jobTitle: string,
  maxContacts: number
): RankedRecruiterContact[] {
  return contacts
    .map((contact) => {
      let score = 0;
      const reasons: string[] = [];
      const title = contact.title ?? "";

      for (const [pattern, weight] of TITLE_WEIGHTS) {
        if (pattern.test(title)) {
          score += weight;
          reasons.push(`title:${title}`);
          break;
        }
      }

      if (/recruit|talent|human resources|\bhr\b/i.test(contact.department ?? "")) {
        score += 15;
        reasons.push("recruiting-related department");
      }

      if (/senior|lead|manager|partner|director|head/i.test(contact.seniority ?? "")) {
        score += 8;
        reasons.push("senior recruiting signal");
      }

      if (contact.verified) {
        score += 20;
        reasons.push("verified email");
      }

      if (typeof contact.confidence === "number") {
        score += Math.round(contact.confidence / 5);
        reasons.push(`provider confidence:${contact.confidence}`);
      }

      if (jobTitle && /engineer|developer|software|frontend|backend|full.?stack/i.test(jobTitle)) {
        if (/technical|engineering|recruit|talent|hiring/i.test(title)) {
          score += 10;
          reasons.push("technical-role alignment");
        }
      }

      return { ...contact, score, reasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxContacts);
}
