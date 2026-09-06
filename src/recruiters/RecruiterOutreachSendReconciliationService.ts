import { Database } from "../database/Database";
import { GmailMailbox } from "../email/GmailMailbox";
import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { deterministicMessageId } from "./RecruiterOutreachSendService";

interface StaleSendingMessage { id:string; recipientEmail:string; subject:string; sendClaimedAt:Date; }
export interface RecruiterOutreachReconciliationResult { inspected:number; reconciled:number; unresolved:number; }

export class RecruiterOutreachSendReconciliationService {
 constructor(private readonly database:Database,private readonly repository:RecruiterDiscoveryRepository,private readonly mailbox:GmailMailbox,private readonly staleAfterMinutes=5,private readonly sentMailboxScanLimit=200){}
 async runOnce():Promise<RecruiterOutreachReconciliationResult>{
  if(this.staleAfterMinutes<1)throw new Error("Recruiter reconciliation stale threshold must be positive.");
  if(this.sentMailboxScanLimit<1)throw new Error("Recruiter reconciliation mailbox scan limit must be positive.");
  const result=await this.database.query<StaleSendingMessage>(`SELECT id,recipient_email AS "recipientEmail",subject,send_claimed_at AS "sendClaimedAt" FROM recruiter_outreach_messages WHERE status='SENDING' AND send_claimed_at IS NOT NULL AND send_claimed_at<=NOW()-($1*INTERVAL '1 minute') ORDER BY send_claimed_at ASC LIMIT $2`,[this.staleAfterMinutes,this.sentMailboxScanLimit]);
  if(result.rows.length===0)return{inspected:0,reconciled:0,unresolved:0};
  const sentIds=await this.mailbox.listMessages("in:sent newer_than:7d",this.sentMailboxScanLimit);
  const sentMessages=new Map<string,{gmailMessageId:string;gmailThreadId:string}>();
  for(const gmailMessageId of sentIds){const message=await this.mailbox.getMessage(gmailMessageId);if(message.rfcMessageId)sentMessages.set(message.rfcMessageId,{gmailMessageId:message.gmailMessageId,gmailThreadId:message.gmailThreadId});}
  let reconciled=0;
  for(const stale of result.rows){const sent=sentMessages.get(deterministicMessageId(stale.id));if(!sent)continue;await this.repository.markOutreachMessageSent(stale.id,{provider:"gmail",providerMessageId:sent.gmailMessageId,providerThreadId:sent.gmailThreadId});reconciled+=1;}
  return{inspected:result.rows.length,reconciled,unresolved:result.rows.length-reconciled};
 }
}
