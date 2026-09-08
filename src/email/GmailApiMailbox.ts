import { GmailMailbox, GmailMessage, GmailClassification, GmailAttachment } from "./GmailMailbox";
import { GmailOAuthClient } from "./GmailOAuthClient";

interface GmailHeader { name?: string; value?: string; }
interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; }
interface GmailApiMessage { id?: string; threadId?: string; internalDate?: string; snippet?: string; payload?: { headers?: GmailHeader[]; mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; }; }
interface GmailListResponse { messages?: Array<{ id?: string }>; nextPageToken?: string; }
interface GmailSendResponse { id?: string; threadId?: string; }
export interface GmailApiMailboxOptions {
  oauth: GmailOAuthClient;
  userEmail: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryDelayMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}
function header(message:GmailApiMessage,name:string):string|null{return message.payload?.headers?.find((item)=>item.name?.toLowerCase()===name.toLowerCase())?.value?.trim()??null;}
function decodeBase64Url(value:string):string{const normalized=value.replace(/-/g,"+").replace(/_/g,"/");return Buffer.from(normalized,"base64").toString("utf8");}
function stripHtml(value:string):string{return value.replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim();}
function collectBodies(part:GmailPart|undefined,output:string[]):void{if(!part)return;if(part.body?.data&&part.mimeType==="text/plain")output.push(decodeBase64Url(part.body.data));else if(part.body?.data&&part.mimeType==="text/html"&&output.length===0)output.push(stripHtml(decodeBase64Url(part.body.data)));for(const child of part.parts??[])collectBodies(child,output);}
function parseSender(value:string|null):{name:string|null;email:string|null}{if(!value)return{name:null,email:null};const match=value.match(/^(.*?)\s*<([^>]+)>$/);if(match){const namePart=match[1];const emailPart=match[2];if(namePart!==undefined&&emailPart!==undefined)return{name:namePart.replace(/^\"|\"$/g,"").trim()||null,email:emailPart.trim()};}return{name:null,email:value.trim()};}
function retryAfterMs(response:Response,fallbackMs:number):number{const value=response.headers.get("retry-after");if(!value)return fallbackMs;const seconds=Number(value);if(Number.isFinite(seconds)&&seconds>=0)return Math.min(seconds*1000,30_000);const dateMs=Date.parse(value);if(!Number.isNaN(dateMs))return Math.min(Math.max(0,dateMs-Date.now()),30_000);return fallbackMs;}
function encodeHeader(value:string):string{if(/^[\x20-\x7e]*$/.test(value))return value;return `=?UTF-8?B?${Buffer.from(value,"utf8").toString("base64")}?=`;}
function foldBase64(value:string):string{return value.replace(/.{1,76}/g,"$&\r\n").trimEnd();}
function buildMimeMessage(message:{to:string;subject:string;bodyText:string;inReplyTo?:string;references?:string;messageId?:string;attachments?:readonly GmailAttachment[]},from:string):string{
  const attachments=message.attachments??[];
  const boundary=`job-agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  const headers=[`To: ${encodeHeader(message.to)}`,`From: ${encodeHeader(from)}`,`Subject: ${encodeHeader(message.subject)}`,message.messageId?`Message-ID: ${message.messageId}`:"",message.inReplyTo?`In-Reply-To: ${message.inReplyTo}`:"",message.references?`References: ${message.references}`:"","MIME-Version: 1.0"];
  if(attachments.length===0){headers.push("Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: 8bit","",message.bodyText);return headers.filter(Boolean).join("\r\n");}
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`,"");
  const parts=[`--${boundary}`,"Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: 8bit","",message.bodyText];
  for(const attachment of attachments){
    const filename=attachment.filename.replace(/[\r\n\"\\]/g,"_");
    const contentType=attachment.contentType.replace(/[\r\n]/g,"")||"application/octet-stream";
    parts.push(`--${boundary}`,`Content-Type: ${contentType}; name="${filename}"`,`Content-Disposition: attachment; filename="${filename}"`,"Content-Transfer-Encoding: base64","",foldBase64(attachment.content.toString("base64")));
  }
  parts.push(`--${boundary}--`,"");
  return headers.filter(Boolean).join("\r\n")+"\r\n"+parts.join("\r\n");
}
export class GmailApiMailbox implements GmailMailbox{
 private readonly fetchImpl:typeof fetch;
 private readonly maxRetries:number;
 private readonly retryDelayMs:number;
 private readonly sleepImpl:(ms:number)=>Promise<void>;
 constructor(private readonly options:GmailApiMailboxOptions){this.fetchImpl=options.fetchImpl??fetch;this.maxRetries=Math.max(0,options.maxRetries??2);this.retryDelayMs=Math.max(0,options.retryDelayMs??250);this.sleepImpl=options.sleepImpl??((ms)=>new Promise((resolve)=>setTimeout(resolve,ms)));}
 private async request<T>(url:string,init:RequestInit={}):Promise<T>{const method=(init.method??"GET").toUpperCase();const retryable=method==="GET";let tokenRefreshAttempted=false;for(let attempt=0;;attempt+=1){const accessToken=await this.options.oauth.getAccessToken();let response:Response;try{response=await this.fetchImpl(url,{...init,headers:{authorization:`Bearer ${accessToken}`,...(init.headers??{})}});}catch(error){if(!retryable||attempt>=this.maxRetries)throw error;await this.sleepImpl(this.retryDelayMs*2**attempt);continue;}if(response.ok)return(await response.json()) as T;if(response.status===401&&!tokenRefreshAttempted){tokenRefreshAttempted=true;this.options.oauth.invalidateAccessToken();continue;}const transient=response.status===429||response.status>=500;if(!retryable||!transient||attempt>=this.maxRetries)throw new Error(`Gmail API request failed (${response.status}).`);await this.sleepImpl(retryAfterMs(response,this.retryDelayMs*2**attempt));}}
 async listMessages(query:string,maxResults=50):Promise<readonly string[]>{if(maxResults<=0)return[];const ids:string[]=[];let pageToken:string|undefined;do{const params=new URLSearchParams({q:query,maxResults:String(Math.min(maxResults-ids.length,500))});if(pageToken)params.set("pageToken",pageToken);const response=await this.request<GmailListResponse>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`);for(const message of response.messages??[]){if(message.id)ids.push(message.id);if(ids.length>=maxResults)break;}pageToken=ids.length>=maxResults?undefined:response.nextPageToken;}while(pageToken);return ids;}
 async getMessage(messageId:string):Promise<GmailMessage>{const encodedId=encodeURIComponent(messageId);const response=await this.request<GmailApiMessage>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodedId}?format=full`);if(!response.id||!response.threadId)throw new Error(`Gmail message '${messageId}' returned no stable identifiers.`);const sender=parseSender(header(response,"From"));const bodies:string[]=[];collectBodies(response.payload,bodies);return{gmailMessageId:response.id,gmailThreadId:response.threadId,rfcMessageId:header(response,"Message-ID"),inReplyTo:header(response,"In-Reply-To"),senderEmail:sender.email,senderName:sender.name,recipientEmail:header(response,"To"),subject:header(response,"Subject")??"",receivedAt:response.internalDate?new Date(Number(response.internalDate)):null,snippet:response.snippet??null,bodyText:bodies.join("\n\n").trim(),classification:"OTHER" as GmailClassification};}
 async sendMessage(message:{to:string;subject:string;bodyText:string;threadId?:string;inReplyTo?:string;references?:string;messageId?:string;attachments?:readonly GmailAttachment[]}):Promise<{gmailMessageId:string;gmailThreadId:string}>{const raw=Buffer.from(buildMimeMessage(message,this.options.userEmail),"utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");const response=await this.request<GmailSendResponse>("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({raw,...(message.threadId?{threadId:message.threadId}:{})})});if(!response.id||!response.threadId)throw new Error("Gmail send returned no message/thread identifier.");return{gmailMessageId:response.id,gmailThreadId:response.threadId};}
}
export { buildMimeMessage };
