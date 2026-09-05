export type JobRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface JobRiskInput {
  title: string;
  companyName: string;
  description: string;
}

export interface JobRiskResult {
  level: JobRiskLevel;
  score: number;
  reasons: readonly string[];
}

const HIGH_RISK_PATTERNS: readonly [RegExp, string, number][] = [
  [/pay\s+(?:a|an|the)?\s*(?:fee|deposit|registration|training)\b/i, "Job asks the candidate to pay a fee or deposit.", 100],
  [/send\s+(?:money|funds|payment)\b/i, "Job asks the candidate to send money.", 100],
  [/gift\s*card/i, "Job mentions gift-card payment as part of the hiring process.", 100],
  [/crypto(?:currency)?\s+(?:payment|deposit|transfer)/i, "Job requests cryptocurrency payment or transfer.", 100],
  [/purchase\s+(?:equipment|software)\s+(?:from|through)\s+us/i, "Job asks the candidate to purchase equipment or software through the employer.", 90]
];

const MEDIUM_RISK_PATTERNS: readonly [RegExp, string, number][] = [
  [/contact\s+(?:only\s+)?(?:via\s+)?telegram/i, "Recruitment appears to rely on Telegram-only contact.", 35],
  [/contact\s+(?:only\s+)?(?:via\s+)?whatsapp/i, "Recruitment appears to rely on WhatsApp-only contact.", 30],
  [/pay\s+for\s+(?:your\s+)?own\s+background\s+check/i, "Job asks the candidate to pay for a background check.", 60]
];

export function assessJobRisk(input: JobRiskInput): JobRiskResult {
  const text = `${input.title}\n${input.companyName}\n${input.description}`;
  const reasons: string[] = [];
  let score = 0;

  for (const [pattern, reason, weight] of HIGH_RISK_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push(reason);
      score = Math.max(score, weight);
    }
  }

  for (const [pattern, reason, weight] of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push(reason);
      score = Math.max(score, weight);
    }
  }

  const level: JobRiskLevel = score >= 80 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
  return { level, score, reasons };
}
