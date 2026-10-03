import "dotenv/config";
import { GmailApiMailbox } from "../src/email/GmailApiMailbox";
import { GmailOAuthClient } from "../src/email/GmailOAuthClient";
import { loadResumeAttachment } from "../src/recruiters/RecruiterOutreachSendService";
import { Database } from "../src/database/Database";

interface GmailHeader { name?: string; value?: string; }
interface GmailMessagePart { mimeType?: string; body?: { data?: string }; parts?: GmailMessagePart[]; }
interface GmailThreadMessage { id?: string; threadId?: string; internalDate?: string; labelIds?: string[]; payload?: { headers?: GmailHeader[]; body?: { data?: string }; parts?: GmailMessagePart[]; }; }
interface GmailThread { messages?: GmailThreadMessage[]; }

const MARKER = "JOB_AGENT_HISTORICAL_FOLLOWUP_V1";
const JOB_SIGNAL = /application|resume|cv|frontend|front-end|react|next(?:\.js|js)?|full[ -]?stack|software engineer|developer|job|hiring|career/i;
const DEFAULT_MAX = 5;

function header(message: GmailThreadMessage, name: string): string { return message.payload?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? ""; }
function decodeBase64Url(value: string): string { return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); }
function bodyText(part: GmailMessagePart | undefined, output: string[]): void { if (!part) return; if (part.body?.data && part.mimeType === "text/plain") output.push(decodeBase64Url(part.body.data)); for (const child of part.parts ?? []) bodyText(child, output); }
function messageBody(message: GmailThreadMessage): string { const parts: string[] = []; bodyText(message.payload, parts); return parts.join("\n\n"); }
function fromIsUser(message: GmailThreadMessage, userEmail: string): boolean { return header(message, "From").toLowerCase().includes(userEmail.toLowerCase()); }

async function fetchThread(oauth: GmailOAuthClient, threadId: string): Promise<GmailThread> {
  const token = await oauth.getAccessToken();
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/threads/" + encodeURIComponent(threadId) + "?format=full", { headers: { authorization: "Bearer " + token } });
  if (!response.ok) throw new Error("Gmail thread fetch failed (" + response.status + ").");
  return await response.json() as GmailThread;
}

async function main(): Promise<void> {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
  const userEmail = process.env.GMAIL_USER_EMAIL?.trim().toLowerCase();
  if (!clientId || !clientSecret || !refreshToken || !userEmail) throw new Error("Gmail OAuth configuration is incomplete.");

  const minAgeDays = Math.max(1, Number(process.env.GMAIL_HISTORY_FOLLOWUP_MIN_AGE_DAYS ?? 4));
  const maxAgeDays = Math.max(minAgeDays, Number(process.env.GMAIL_HISTORY_FOLLOWUP_MAX_AGE_DAYS ?? 45));
  const maxMessages = Math.max(1, Number(process.env.GMAIL_HISTORY_FOLLOWUP_MAX_MESSAGES ?? DEFAULT_MAX));
  const query = process.env.GMAIL_HISTORY_FOLLOWUP_QUERY?.trim() || "in:sent newer_than:90d";
  const sendEnabled = process.env.GMAIL_HISTORY_FOLLOWUP_SEND_ENABLED === "true";
  const live = process.env.RECRUITER_OUTREACH_ACTIVATION === "live" && process.env.RECRUITER_LIVE_ACTIVATION_CONFIRMED === "true";
  const outbound = process.env.OUTBOUND_ENABLED === "true";
  const gmailEnabled = process.env.GMAIL_ENABLED === "true";
  const confirmed = process.env.GMAIL_HISTORY_FOLLOWUP_CONFIRM === "SALMAN_HISTORY_FOLLOWUP_LIVE";

  const oauth = new GmailOAuthClient({ clientId, clientSecret, refreshToken });
  const mailbox = new GmailApiMailbox({ oauth, userEmail });
  const ids = await mailbox.listMessages(query, 100);
  const now = Date.now();
  const minAgeMs = minAgeDays * 86400000; const maxAgeMs = maxAgeDays * 86400000;
  const candidates: Array<{ id: string; threadId: string; to: string; subject: string; sentAt: Date; inReplyTo: string; references: string }> = [];

  for (const id of ids) {
    const message = await mailbox.getMessage(id);
    if (!message.gmailThreadId || !message.recipientEmail || !message.receivedAt) continue;
    if (message.senderEmail?.toLowerCase() !== userEmail) continue;
    if (!JOB_SIGNAL.test(message.subject + " " + message.bodyText)) continue;
    const age = now - message.receivedAt.getTime();
    if (age < minAgeMs || age > maxAgeMs) continue;
    const thread = await fetchThread(oauth, message.gmailThreadId);
    const threadMessages = thread.messages ?? [];
    if (threadMessages.some((item) => messageBody(item).includes(MARKER))) continue;
    const sorted = [...threadMessages].sort((a,b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
    const latest = sorted[sorted.length - 1];
    if (!latest || !fromIsUser(latest, userEmail)) continue;
    candidates.push({ id, threadId: message.gmailThreadId, to: message.recipientEmail, subject: message.subject, sentAt: message.receivedAt, inReplyTo: header(latest, "Message-ID"), references: header(latest, "References") });
    if (candidates.length >= maxMessages) break;
  }

  const prepared = candidates.map((candidate) => ({
    ...candidate,
    subject: /^re:/i.test(candidate.subject) ? candidate.subject : "Re: " + candidate.subject,
    body: "Hi,\n\nJust following up on my earlier email regarding opportunities at your organization. I remain interested in relevant Frontend / React / Next.js / Full Stack roles and have attached my latest resume for reference.\n\nIf there is a suitable opening, I would appreciate being considered.\n\nThank you,\nSalman Shaikh\n\n" + MARKER
  }));

  if (!sendEnabled || !live || !outbound || !gmailEnabled || !confirmed) {
    console.log(JSON.stringify({status:"READY",feature:"GMAIL_HISTORICAL_FOLLOWUP",live:false,candidates:prepared.length,prepared:prepared.map(({to,subject,sentAt})=>({to,subject,sentAt})),nextStep:"Set GMAIL_HISTORY_FOLLOWUP_SEND_ENABLED=true, live recruiter gates, and GMAIL_HISTORY_FOLLOWUP_CONFIRM=SALMAN_HISTORY_FOLLOWUP_LIVE to send."},null,2));
    return;
  }

  const attachment = await loadResumeAttachment(process.env.CANDIDATE_RESUME_PATH, Number(process.env.RECRUITER_MAX_ATTACHMENT_BYTES ?? 10485760));
  if (!attachment) throw new Error("No resume PDF found. Put the latest resume in data/resumes or set CANDIDATE_RESUME_PATH.");
  const db = new Database(process.env.DATABASE_URL ?? "");
  let sent = 0; let skipped = 0;
  try {
    for (const candidate of prepared) {
      const domain = candidate.to.split("@")[1]?.toLowerCase() ?? "";
      const suppression = await db.query<{ email_suppressed: boolean; domain_suppressed: boolean }>("SELECT EXISTS (SELECT 1 FROM recruiter_suppressions WHERE LOWER(email)=LOWER($1)) AS email_suppressed, EXISTS (SELECT 1 FROM recruiter_suppressions WHERE LOWER(company_domain)=LOWER($2)) AS domain_suppressed",[candidate.to,domain]);
      if (suppression.rows[0]?.email_suppressed || suppression.rows[0]?.domain_suppressed) { skipped += 1; continue; }
      await mailbox.sendMessage({ to:candidate.to, subject:candidate.subject, bodyText:candidate.body, threadId:candidate.threadId, inReplyTo:candidate.inReplyTo, references:candidate.references, attachments:[attachment] });
      sent += 1;
    }
  } finally { await db.close(); }
  console.log(JSON.stringify({status:"ok",feature:"GMAIL_HISTORICAL_FOLLOWUP",live:true,candidates:prepared.length,sent,skipped,attachment:attachment.filename},null,2));
}
void main().catch((error) => { console.error(JSON.stringify({status:"FAILED",feature:"GMAIL_HISTORICAL_FOLLOWUP",error:error instanceof Error?error.message:String(error)},null,2)); process.exitCode=1; });