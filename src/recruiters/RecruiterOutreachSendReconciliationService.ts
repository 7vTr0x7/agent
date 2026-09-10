import { randomUUID } from "node:crypto";
import { Database } from "../database/Database";
import { GmailMailbox } from "../email/GmailMailbox";
import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { deterministicMessageId } from "./RecruiterOutreachSendService";

interface StaleSendingMessage { id:string; recipientEmail:string; subject:string; sendClaimedAt:Date; companyDomain:string; }
export interface RecruiterOutreachReconciliationResult { inspected:number; reconciled:number; requeued:number; unresolved:number; }

export class RecruiterOutreachSendReconciliationService {
 constructor(private readonly database:Database,private readonly repository:RecruiterDiscoveryRepository,private readonly mailbox:GmailMailbox,private readonly staleAfterMinutes=15,private readonly sentMailboxScanLimit=200){}
 async runOnce():Promise<RecruiterOutreachReconciliationResult>{
  if(this.staleAfterMinutes<1)throw new Error("Recruiter reconciliation stale threshold must be positive.");
  if(this.sentMailboxScanLimit<1)throw new Error("Recruiter reconciliation mailbox scan limit must be positive.");
  const result=await this.database.query<StaleSendingMessage>(`SELECT m.id,m.recipient_email AS "recipientEmail",m.subject,m.send_claimed_at AS "sendClaimedAt",c.company_domain AS "companyDomain" FROM recruiter_outreach_messages m JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id JOIN recruiter_contacts c ON c.id=s.recruiter_contact_id WHERE m.status='SENDING' AND m.send_claimed_at IS NOT NULL AND m.send_claimed_at<=NOW()-($1*INTERVAL '1 minute') ORDER BY m.send_claimed_at ASC LIMIT $2`,[this.staleAfterMinutes,this.sentMailboxScanLimit]);
  if(result.rows.length===0)return{inspected:0,reconciled:0,requeued:0,unresolved:0};
  const sentMessages=new Map<string,{gmailMessageId:string;gmailThreadId:string}>();
  for(const stale of result.rows){const ids=await this.mailbox.listMessages(`rfc822msgid:${deterministicMessageId(stale.id)}`,10);for(const gmailMessageId of ids){const message=await this.mailbox.getMessage(gmailMessageId);if(message.rfcMessageId===deterministicMessageId(stale.id)){sentMessages.set(stale.id,{gmailMessageId:message.gmailMessageId,gmailThreadId:message.gmailThreadId});break;}}}
  const sentIds=await this.mailbox.listMessages("in:sent newer_than:7d",this.sentMailboxScanLimit);
  for(const gmailMessageId of sentIds){const message=await this.mailbox.getMessage(gmailMessageId);if(!message.rfcMessageId)continue;for(const stale of result.rows){if(message.rfcMessageId===deterministicMessageId(stale.id))sentMessages.set(stale.id,{gmailMessageId:message.gmailMessageId,gmailThreadId:message.gmailThreadId});}}
  let reconciled=0;let requeued=0;let unresolved=0;
  for(const stale of result.rows){const sent=sentMessages.get(stale.id);if(sent){await this.repository.markOutreachMessageSent(stale.id,{provider:"gmail",providerMessageId:sent.gmailMessageId,providerThreadId:sent.gmailThreadId});reconciled+=1;continue;}const requeuedResult=await this.database.query<{id:string}>(`UPDATE recruiter_outreach_messages SET status='PREPARED',send_claimed_at=NULL,failure_reason='Ambiguous Gmail send not found by deterministic Message-ID reconciliation; safely requeued.',updated_at=NOW() WHERE id=$1 AND status='SENDING' RETURNING id`,[stale.id]);if(requeuedResult.rows[0]){await this.database.query(`INSERT INTO tasks (id,task_type,payload,priority,available_at,max_attempts,dedupe_key,lease_expires_at) VALUES ($1,'SEND_RECRUITER_EMAIL',$2::jsonb,30,NOW(),3,$3,NULL) ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('PENDING','RUNNING') DO UPDATE SET updated_at=NOW()`,[randomUUID(),JSON.stringify({messageId:stale.id,companyDomain:stale.companyDomain}),`recruiter-email-send:${stale.id}`]);requeued+=1;}else unresolved+=1;}
  return{inspected:result.rows.length,reconciled,requeued,unresolved};
 }
}
