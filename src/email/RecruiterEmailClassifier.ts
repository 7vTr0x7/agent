import { GmailClassification, GmailMessage } from "./GmailMailbox";

const RULES: readonly [GmailClassification, readonly RegExp[]][] = [
  ["REJECTION", [
    /we (?:will|are) not moving forward/i,
    /not moving forward with your application/i,
    /unfortunately.*application/i,
    /decided not to proceed/i,
    /position has been filled/i,
    /we regret to inform/i,
    /not selected/i
  ]],
  ["INTERVIEW", [
    /interview/i,
    /technical round/i,
    /coding round/i,
    /schedule.*call/i,
    /meet(?:ing)? invite/i,
    /google meet/i,
    /microsoft teams/i,
    /zoom/i
  ]],
  ["POSITIVE", [
    /shortlisted/i,
    /moving forward/i,
    /next step/i,
    /next steps/i,
    /selected for/i,
    /profile.*shortlisted/i,
    /we'd like to proceed/i
  ]],
  ["APPLICATION_CONFIRMATION", [
    /application.*received/i,
    /application.*submitted/i,
    /thank you for applying/i,
    /received your application/i,
    /application confirmation/i
  ]]
];

export class RecruiterEmailClassifier {
  classify(message: Pick<GmailMessage, "subject" | "bodyText">): GmailClassification {
    const text = `${message.subject}\n${message.bodyText}`;

    for (const [classification, patterns] of RULES) {
      if (patterns.some((pattern) => pattern.test(text))) {
        return classification;
      }
    }

    return "OTHER";
  }
}
