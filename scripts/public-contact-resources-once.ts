import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { Database } from "../src/database/Database";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { sourceList } from "../src/recruiters/PublicSearchProviderRegistry";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";

type Resource={url:string;sourceType:"HTML"|"TEXT"|"CSV"|"JSON"};
const EMAIL=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CONTACT_RESOURCE_BLOCKED_HOSTS=new Set(["simplyhired.com","joblist.com","snagajob.com"]);
const SEARCH_HOSTS=new Set(["google.com","www.google.com","bing.com","www.bing.com","html.duckduckgo.com","duckduckgo.com","startpage.com","www.startpage.com","search.yahoo.com","www.yahoo.com","search.brave.com","www.mojeek.com","qwant.com","www.qwant.com","r.jina.ai"]);
const GENERIC=/^(noreply|no-reply|postmaster|webmaster|admin|support|privacy|legal|press|media|marketing|sales)$/i;
const RELEVANT=/recruit|recruiting|talent acquisition|talent|hiring|hire|human resources|\bhr\b|career|jobs?|engineering manager|engineering lead|people operations|resume|cv|frontend|react|next\.js|software engineer|developer/i;

function clean(v:string){return v.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim()}
function canonical(v:string){try{const u=new URL(v);u.hash="";return u.toString().replace(/\/$/,"")}catch{return v}}
function host(v:string){try{return new URL(v).hostname.toLowerCase().replace(/^www\./,"")}catch{return ""}}
function typeFor(url:string,ct:string):Resource["sourceType"]{const p=(()=>{try{return new URL(url).pathname.toLowerCase()}catch{return ""}})();if(/\.csv(?:$|\?)/.test(p)||ct.includes("csv"))return "CSV";if(/\.json(?:$|\?)/.test(p)||ct.includes("json"))return "JSON";if(/\.txt(?:$|\?)/.test(p)||ct.startsWith("text/plain"))return "TEXT";return "HTML"}
function legitimate(url:string){try{const u=new URL(url),h=host(url),p=u.pathname.toLowerCase();const isSearchHost=SEARCH_HOSTS.has(h)||[...SEARCH_HOSTS].some(domain=>h.endsWith(`.${domain}`));const isBlockedResourceHost=CONTACT_RESOURCE_BLOCKED_HOSTS.has(h)||[...CONTACT_RESOURCE_BLOCKED_HOSTS].some(domain=>h.endsWith(`.${domain}`));if(!/^https?:$/.test(u.protocol)||!h||isSearchHost||isBlockedResourceHost||h==="localhost"||h.endsWith(".local"))return false;if(/^\/(?:api|search|query|suggest|autocomplete|static|assets?|scripts?|css|js)(?:\/|$)/.test(p))return false;if(/\.(?:js|css|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot)(?:$|[?#])/i.test(p))return false;return true}catch{return false}}
type FetchResult =
 | {ok:true;text:string;contentType:string;finalUrl:string;httpStatus:number;bytesRead:number;elapsedMs:number}
 | {ok:false;failureReason:"HTTP_NON_2XX"|"TIMEOUT"|"NETWORK_ERROR"|"REDIRECT_ERROR"|"CONTENT_TOO_LARGE"|"EMPTY_BODY"|"UNSUPPORTED_CONTENT_TYPE"|"PARSER_ERROR"|"EMAIL_EXTRACTION_ERROR";httpStatus?:number;contentType?:string;finalUrl?:string;bytesRead?:number;elapsedMs:number;errorCode?:string};

export function isPrivateAddress(address:string):boolean{
 const version=isIP(address);
 if(version===4){
  const p=address.split(".").map(Number);if(p.length!==4||p.some(n=>!Number.isInteger(n)))return true;
  const [a,b]=p as [number,number];
  return a===0||a===10||a===127||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===198&&(b===18||b===19))||(a===100&&b>=64&&b<=127);
 }
 if(version===6){
  const h=address.toLowerCase().split(":").join("").padStart(32,"0");
  return address==="::1"||address==="::"||h.startsWith("fc")||h.startsWith("fd")||h.startsWith("fe8")||h.startsWith("fe9")||h.startsWith("fea")||h.startsWith("feb")||h.startsWith("ff")||h.startsWith("00000000000000000000ffff");
 }
 return true;
}
async function assertPublicFetchUrl(url:string):Promise<void>{
 const u=new URL(url);
 if(!/^https?:$/.test(u.protocol)||!legitimate(url))throw new Error("UNSAFE_FETCH_URL");
 const addresses=await dns.lookup(u.hostname,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(entry=>isPrivateAddress(entry.address)))throw new Error("PRIVATE_OR_NON_PUBLIC_ADDRESS");
}
async function fetchText(url:string):Promise<FetchResult>{
 const started=Date.now();
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),Number(process.env.PUBLIC_CONTACT_RESOURCE_TIMEOUT_MS??12000));
 try{
  let currentUrl=url;
  for(let hop=0;hop<=3;hop++){
   try{
    await assertPublicFetchUrl(currentUrl);
   }catch(error){
    return {ok:false,failureReason:"REDIRECT_ERROR",finalUrl:currentUrl,elapsedMs:Date.now()-started,errorCode:error instanceof Error?error.message:"UNSAFE_FETCH_URL"};
   }
   let response:Response;
   try{
    response=await fetch(currentUrl,{redirect:"manual",signal:controller.signal,headers:{accept:"text/html,text/plain,text/csv,application/json,*/*;q=0.5","user-agent":"job-agent-public-contact-resource-discovery/1.0"}});
   }catch(error){
    const elapsedMs=Date.now()-started;
    const code=error instanceof Error && "code" in error?String((error as Error & {code?:unknown}).code??""):undefined;
    return {ok:false,failureReason:controller.signal.aborted?"TIMEOUT":"NETWORK_ERROR",elapsedMs,errorCode:code};
   }
   if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get("location");
    if(!location||hop===3){
     return {ok:false,failureReason:"REDIRECT_ERROR",httpStatus:response.status,finalUrl:currentUrl,elapsedMs:Date.now()-started,errorCode:location?"REDIRECT_LIMIT":"MISSING_LOCATION"};
    }
    try{
     currentUrl=new URL(location,currentUrl).toString();
    }catch{
     return {ok:false,failureReason:"REDIRECT_ERROR",httpStatus:response.status,finalUrl:currentUrl,elapsedMs:Date.now()-started,errorCode:"INVALID_LOCATION"};
    }
    continue;
   }
   const finalUrl=response.url||currentUrl;
   const contentType=response.headers.get("content-type")?.toLowerCase()??"";
   if(!response.ok){
    return {ok:false,failureReason:"HTTP_NON_2XX",httpStatus:response.status,contentType,finalUrl,elapsedMs:Date.now()-started};
   }
   const maxBytes=Number(process.env.PUBLIC_CONTACT_RESOURCE_MAX_BYTES??8*1024*1024);
   if(response.body){
    const reader=response.body.getReader();
    const chunks:Uint8Array[]=[];
    let total=0;
    try{
     for(;;){
      const part=await reader.read();
      if(part.done)break;
      total+=part.value.byteLength;
      if(total>maxBytes){
       await reader.cancel();
       return {ok:false,failureReason:"CONTENT_TOO_LARGE",httpStatus:response.status,contentType,finalUrl,bytesRead:total,elapsedMs:Date.now()-started};
      }
      chunks.push(part.value);
     }
    }catch(error){
     return {ok:false,failureReason:"NETWORK_ERROR",httpStatus:response.status,contentType,finalUrl,bytesRead:total,elapsedMs:Date.now()-started,errorCode:error instanceof Error?error.name:undefined};
    }finally{
     reader.releaseLock();
    }
    if(total===0){
     return {ok:false,failureReason:"EMPTY_BODY",httpStatus:response.status,contentType,finalUrl,bytesRead:0,elapsedMs:Date.now()-started};
    }
    const out=new Uint8Array(total);
    let offset=0;
    for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}
    return {ok:true,text:new TextDecoder().decode(out),contentType,finalUrl,httpStatus:response.status,bytesRead:total,elapsedMs:Date.now()-started};
   }
   const text=await response.text();
   const bytesRead=new TextEncoder().encode(text).byteLength;
   if(bytesRead===0)return {ok:false,failureReason:"EMPTY_BODY",httpStatus:response.status,contentType,finalUrl,bytesRead,elapsedMs:Date.now()-started};
   if(bytesRead>maxBytes)return {ok:false,failureReason:"CONTENT_TOO_LARGE",httpStatus:response.status,contentType,finalUrl,bytesRead,elapsedMs:Date.now()-started};
   return {ok:true,text,contentType,finalUrl,httpStatus:response.status,bytesRead,elapsedMs:Date.now()-started};
  }
  return {ok:false,failureReason:"REDIRECT_ERROR",finalUrl:currentUrl,elapsedMs:Date.now()-started,errorCode:"REDIRECT_LIMIT"};
 }finally{
  clearTimeout(timeout);
 }
}
async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){const out:R[]=[];let next=0;async function worker(){for(;;){const i=next++;if(i>=items.length)return;const item=items[i];if(item===undefined)continue;out[i]=await fn(item)}}await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out}
export function urlsFromSearch(text:string){
 const candidates=text.match(/https?:\/\/[^\s<>()\]]+/gi)??[];
 return [...new Set(candidates.map(v=>v.replace(/[>"'.,;:!?]+$/g,"")).map(canonical))].filter(legitimate)
}
function resourceLooksRelevant(url:string){try{const u=new URL(url),v=(u.hostname+" "+u.pathname).toLowerCase();return /career|careers|job|jobs|hiring|hire|recruit|recruiting|talent|contact|about|people|team|resume|apply/.test(v)}catch{return false}}
export function extractEmails(text:string){return [...new Set((text.match(EMAIL)??[]).map(v=>v.toLowerCase()))].filter(e=>!GENERIC.test(e.split("@")[0]??"")&&!/^(example|test)@/i.test(e))}
export function relevance(email:string,context:string,skills:string[]){const h=(email+" "+context).toLowerCase();let s=0;if(RELEVANT.test(h))s+=45;if(skills.some(x=>h.includes(x.toLowerCase())))s+=25;if(/resume|cv|apply|hiring|recruit|talent|career/i.test(h))s+=20;if(!/support|privacy|legal|press|newsletter|unsubscribe/i.test(h))s+=10;return Math.min(100,s)}
async function validation(email:string):Promise<"VALID"|"LIKELY"|"UNVERIFIED"|"INVALID">{if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return "INVALID";const d=email.split("@")[1]?.toLowerCase();if(!d)return "INVALID";try{return (await dns.resolveMx(d)).length?"LIKELY":"INVALID"}catch{return "UNVERIFIED"}}

async function main(){
 const profile=await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID??"");
 if(!profile)throw new Error("Configured candidate profile could not be resolved.");
 const db=new Database(process.env.DATABASE_URL??"");
 const recruiterRepository=new ProactiveRecruiterRepository(db);
 const excludedSites="-site:simplyhired.com -site:joblist.com -site:snagajob.com -site:indeed.com -site:linkedin.com -site:glassdoor.com -site:foundit.in";
 const queries=[`inurl:careers "frontend developer" "Bengaluru" "@" ${excludedSites}`,`inurl:careers "React developer" "Bangalore" "@" ${excludedSites}`,`"frontend developer" "careers@" "Bengaluru" ${excludedSites}`,`"React" "careers@" "Bangalore" ${excludedSites}`,`"send your resume" "frontend developer" "Bengaluru" ${excludedSites}`,`"send your resume" "React developer" "India" ${excludedSites}`,`"talent acquisition" "React" "Bengaluru" "@" ${excludedSites}`,`"hiring" "Next.js" "Bengaluru" "careers@" ${excludedSites}`];
  const pages=(await mapLimit(queries,4,async q=>{const rs=await Promise.all(sourceList(q).map(async s=>({url:s.url,response:await fetchText(s.url)})));const successful:{text:string}[]=[];for(const item of rs){if(item.response.ok)successful.push({text:item.response.text});}return successful;})).flat();
 const resources=new Map<string,Resource>();
 for(const page of pages)for(const url of urlsFromSearch(page.text))if(resourceLooksRelevant(url))resources.set(url,{url,sourceType:/\.csv(?:$|\?)/i.test(url)?"CSV":/\.json(?:$|\?)/i.test(url)?"JSON":/\.txt(?:$|\?)/i.test(url)?"TEXT":"HTML"});
 const resourceList=[...resources.values()];
 const processed=await mapLimit(resourceList,4,async resource=>{
  const fetched=await fetchText(resource.url);if(!fetched.ok)return {resource,emails:0,qualified:0,persisted:0,duplicates:0,invalid:0,status:"FAILED" as const,type:resource.sourceType,failureReason:fetched.failureReason,httpStatus:fetched.httpStatus,contentType:fetched.contentType,finalUrl:fetched.finalUrl,bytesRead:fetched.bytesRead,elapsedMs:fetched.elapsedMs,errorCode:fetched.errorCode};
   const type=typeFor(resource.url,fetched.contentType);const fetchedText=fetched.text;const text=type==="HTML"?clean(fetchedText):fetchedText;const emails=extractEmails(text);const resourceContext=resource.url+" "+text;const qualified=emails.filter(e=>relevance(e,resourceContext,[...profile.skills])>=60);
  const title=(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??"").replace(/\s+/g," ").trim().slice(0,300)||null;
  await db.query("INSERT INTO public_contact_resources(source_url,source_type,title,processed_at,status,records_seen,emails_extracted,emails_normalized,invalid_emails,duplicate_emails,qualified_contacts) VALUES($1,$2,$3,NOW(),'PROCESSED',$4,$5,$6,$7,0,$8) ON CONFLICT(source_url) DO UPDATE SET processed_at=EXCLUDED.processed_at,status=EXCLUDED.status,title=EXCLUDED.title,records_seen=EXCLUDED.records_seen,emails_extracted=EXCLUDED.emails_extracted,emails_normalized=EXCLUDED.emails_normalized,invalid_emails=EXCLUDED.invalid_emails,qualified_contacts=EXCLUDED.qualified_contacts",[resource.url,type,title,emails.length,emails.length,emails.length,emails.filter(e=>!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).length,qualified.length]);
  let persisted=0,duplicates=0,invalid=0;
  for(const email of emails){
   const status=await validation(email);if(status==="INVALID"){invalid++;continue}
   const score=relevance(email,`${resource.url} ${text}`,[...profile.skills]);if(score<60)continue;
   const domain=email.split("@")[1]?.toLowerCase()??"";
   const existing=await db.query<{id:string}>("SELECT id FROM recruiter_contacts WHERE LOWER(email)=LOWER($1) LIMIT 1",[email]);
   if(existing.rowCount){duplicates++;continue}
   const candidate={
    contactType:"EMPLOYER" as const,
    recruiterName:"Employer recruiting contact",
    recruiterRole:"Recruiting / Talent / Hiring contact",
    employer:domain,
    employerDomain:domain,
    targetRoles:profile.targetTitles?.slice(0,8)??[],
    roleMatchScore:Math.min(100,Math.max(75,score)),
    hiringEvidenceScore:85,
    overallConfidence:Math.min(100,Math.max(80,score)),
    discoverySource:"public-web" as const,
    discoveryUrl:resource.url,
    discoveryEvidence:[text.slice(0,3500)],
    evidenceType:"job_hiring_evidence" as const,
    evidenceDate:new Date().toISOString(),
    evidenceFreshness:"current" as const,
    email,
    emailStatus:status==="LIKELY"?"LIKELY" as const:"UNVERIFIED" as const
   };
   const id=await recruiterRepository.persistCandidate(process.env.CANDIDATE_PROFILE_ID??"",candidate);
   if(id)persisted++; else duplicates++;
  }
  return {resource,type,emails:emails.length,qualified:qualified.length,persisted,duplicates,invalid,status:"PROCESSED" as const};
 });
 const ok=processed.filter(x=>x.status==="PROCESSED"),failed=processed.filter(x=>x.status==="FAILED"),tot=ok.reduce((a,x)=>({emails:a.emails+x.emails,qualified:a.qualified+x.qualified,persisted:a.persisted+x.persisted,duplicates:a.duplicates+x.duplicates,invalid:a.invalid+x.invalid}),{emails:0,qualified:0,persisted:0,duplicates:0,invalid:0});
 await db.close();
 console.log(JSON.stringify({status:"ok",feature:"PUBLIC_CONTACT_RESOURCE",independent:true,sendEnabled:false,resourcesDiscovered:resourceList.length,resourcesProcessed:ok.length,emailsExtracted:tot.emails,emailsNormalized:tot.emails,invalidEmails:tot.invalid,duplicateEmails:tot.duplicates,qualifiedContacts:tot.qualified,contactsPersisted:tot.persisted,locationPriority:["Bengaluru","Bangalore","India","Remote"],formatsProcessed:[...new Set(ok.map(x=>x.type))],failedResources:failed.map(x=>({url:x.resource.url,status:"FAILED",failureReason:x.failureReason,httpStatus:x.httpStatus,contentType:x.contentType,finalUrl:x.finalUrl,bytesRead:x.bytesRead,elapsedMs:x.elapsedMs,errorCode:x.errorCode})),maxResourceBytes:Number(process.env.PUBLIC_CONTACT_RESOURCE_MAX_BYTES??8*1024*1024),results:ok.filter(x=>x.emails>0).slice(0,20).map(x=>({source:x.resource.url,sourceType:x.type,emailsExtracted:x.emails,qualifiedContacts:x.qualified,persisted:x.persisted}))},null,2));
}
if (require.main === module) main().catch(e=>{console.error(JSON.stringify({status:"FAILED",feature:"PUBLIC_CONTACT_RESOURCE",error:e instanceof Error?e.message:String(e)},null,2));process.exitCode=1});
