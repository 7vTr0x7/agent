import { promises as dns } from "node:dns";
import { Database } from "../src/database/Database";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { sourceList } from "../src/recruiters/PublicSearchProviderRegistry";

type Resource={url:string;sourceType:"HTML"|"TEXT"|"CSV"|"JSON"};
const EMAIL=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SEARCH_HOSTS=new Set(["google.com","www.google.com","bing.com","www.bing.com","html.duckduckgo.com","duckduckgo.com","startpage.com","www.startpage.com","search.yahoo.com","www.yahoo.com","search.brave.com","www.mojeek.com","qwant.com","www.qwant.com","r.jina.ai"]);
const GENERIC=/^(noreply|no-reply|postmaster|webmaster|admin|support|privacy|legal|press|media|marketing|sales)$/i;
const RELEVANT=/recruit|recruiting|talent acquisition|talent|hiring|hire|human resources|\bhr\b|career|jobs?|engineering manager|engineering lead|people operations|resume|cv|frontend|react|next\.js|software engineer|developer/i;

function clean(v:string){return v.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim()}
function canonical(v:string){try{const u=new URL(v);u.hash="";return u.toString().replace(/\/$/,"")}catch{return v}}
function host(v:string){try{return new URL(v).hostname.toLowerCase().replace(/^www\./,"")}catch{return ""}}
function typeFor(url:string,ct:string):Resource["sourceType"]{const p=(()=>{try{return new URL(url).pathname.toLowerCase()}catch{return ""}})();if(/\.csv(?:$|\?)/.test(p)||ct.includes("csv"))return "CSV";if(/\.json(?:$|\?)/.test(p)||ct.includes("json"))return "JSON";if(/\.txt(?:$|\?)/.test(p)||ct.startsWith("text/plain"))return "TEXT";return "HTML"}
function legitimate(url:string){try{const u=new URL(url),h=host(url),p=u.pathname.toLowerCase();if(!/^https?:$/.test(u.protocol)||!h||SEARCH_HOSTS.has(h)||h==="localhost"||h.endsWith(".local"))return false;if(/^\/(?:api|search|query|suggest|autocomplete|static|assets?|scripts?|css|js)(?:\/|$)/.test(p))return false;if(/\.(?:js|css|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot)(?:$|[?#])/i.test(p))return false;return true}catch{return false}}
async function fetchText(url:string){const c=new AbortController(),t=setTimeout(()=>c.abort(),7000);try{const r=await fetch(url,{redirect:"follow",signal:c.signal,headers:{accept:"text/html,text/plain,text/csv,application/json,*/*;q=0.5","user-agent":"job-agent-public-contact-resource-discovery/1.0"}});if(!r.ok)return null;return {text:await r.text(),contentType:r.headers.get("content-type")?.toLowerCase()??""}}catch{return null}finally{clearTimeout(t)}}
async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){const out:R[]=[];let next=0;async function worker(){for(;;){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i])}}await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out}
function urlsFromSearch(text:string){return [...new Set((text.match(/https?:\/\/[^\s<>()\]]+/gi)??[]).map(canonical))].filter(legitimate)}
function extractEmails(text:string){return [...new Set((text.match(EMAIL)??[]).map(v=>v.toLowerCase()))].filter(e=>!GENERIC.test(e.split("@")[0]??"")&&!/^(example|test)@/i.test(e))}
function relevance(email:string,context:string,skills:string[]){const h=(email+" "+context).toLowerCase();let s=0;if(RELEVANT.test(h))s+=45;if(skills.some(x=>h.includes(x.toLowerCase())))s+=25;if(/resume|cv|apply|hiring|recruit|talent|career/i.test(h))s+=20;if(!/support|privacy|legal|press|newsletter|unsubscribe/i.test(h))s+=10;return Math.min(100,s)}
async function validation(email:string):Promise<"VALID"|"LIKELY"|"UNVERIFIED"|"INVALID">{if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return "INVALID";const d=email.split("@")[1]?.toLowerCase();if(!d)return "INVALID";try{return (await dns.resolveMx(d)).length?"LIKELY":"INVALID"}catch{return "UNVERIFIED"}}

async function main(){
 const profile=await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID??"");
 if(!profile)throw new Error("Configured candidate profile could not be resolved.");
 const db=new Database(process.env.DATABASE_URL??"");
 const queries=["frontend developer hiring resume email Bengaluru","react developer hiring email India","we are hiring frontend recruiter email","we are hiring React resume email","talent acquisition frontend email India","technical recruiter React email Bengaluru","send your resume frontend developer","careers React recruiter email"];
 const pages=(await mapLimit(queries,4,async q=>{const rs=await Promise.all(sourceList(q).map(async s=>({response:await fetchText(s.url)})));return rs.filter(x=>x.response).map(x=>({text:x.response!.text}))})).flat();
 const resources=new Map<string,Resource>();
 for(const page of pages)for(const url of urlsFromSearch(page.text))resources.set(url,{url,sourceType:/\.csv(?:$|\?)/i.test(url)?"CSV":/\.json(?:$|\?)/i.test(url)?"JSON":/\.txt(?:$|\?)/i.test(url)?"TEXT":"HTML"});
 const resourceList=[...resources.values()].slice(0,50);
 const processed=await mapLimit(resourceList,4,async resource=>{
  const fetched=await fetchText(resource.url);if(!fetched)return {resource,emails:0,qualified:0,persisted:0,duplicates:0,invalid:0,status:"FAILED" as const,type:resource.sourceType};
  const type=typeFor(resource.url,fetched.contentType),text=type==="HTML"?clean(fetched.text):fetched.text,emails=extractEmails(text),qualified=emails.filter(e=>relevance(e,text,profile.skills)>=60);
  const title=(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??"").replace(/\s+/g," ").trim().slice(0,300)||null;
  await db.query("INSERT INTO public_contact_resources(source_url,source_type,title,processed_at,status,records_seen,emails_extracted,emails_normalized,invalid_emails,duplicate_emails,qualified_contacts) VALUES($1,$2,$3,NOW(),'PROCESSED',$4,$5,$6,$7,0,$8) ON CONFLICT(source_url) DO UPDATE SET processed_at=EXCLUDED.processed_at,status=EXCLUDED.status,title=EXCLUDED.title,records_seen=EXCLUDED.records_seen,emails_extracted=EXCLUDED.emails_extracted,emails_normalized=EXCLUDED.emails_normalized,invalid_emails=EXCLUDED.invalid_emails,qualified_contacts=EXCLUDED.qualified_contacts",[resource.url,type,title,emails.length,emails.length,emails.length,emails.filter(e=>!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).length,qualified.length]);
  let persisted=0,duplicates=0,invalid=0;
  for(const email of emails){
   const status=await validation(email);if(status==="INVALID"){invalid++;continue}
   const score=relevance(email,text,profile.skills);if(score<60)continue;
   const domain=email.split("@")[1]?.toLowerCase()??"";
   const existing=await db.query<{id:string}>("SELECT id FROM contacts WHERE normalized_email=LOWER($1) OR LOWER(email)=LOWER($1) LIMIT 1",[email]);
   if(existing.rowCount){duplicates++;continue}
   await db.query("INSERT INTO contacts(company_name,name,email,role,source,normalized_email,source_url,source_type,provenance,validation_status,relevance_score,suppressed) VALUES($1,NULL,$2,$3,$4,$2,$5,$6,$7,$8,$9,FALSE) ON CONFLICT(email) DO NOTHING",[domain,email,/recruit|talent|hr|hiring/i.test(text)?"Recruiting / Talent / Hiring contact":"Professional contact","PUBLIC_CONTACT_RESOURCE:"+resource.url,resource.url,type,JSON.stringify({sourceUrl:resource.url,sourceType:type}),status,score]);
   persisted++;
  }
  return {resource,type,emails:emails.length,qualified:qualified.length,persisted,duplicates,invalid,status:"PROCESSED" as const};
 });
 const ok=processed.filter(x=>x.status==="PROCESSED"),tot=ok.reduce((a,x)=>({emails:a.emails+x.emails,qualified:a.qualified+x.qualified,persisted:a.persisted+x.persisted,duplicates:a.duplicates+x.duplicates,invalid:a.invalid+x.invalid}),{emails:0,qualified:0,persisted:0,duplicates:0,invalid:0});
 await db.close();
 console.log(JSON.stringify({status:"ok",feature:"PUBLIC_CONTACT_RESOURCE",independent:true,sendEnabled:false,resourcesDiscovered:resourceList.length,resourcesProcessed:ok.length,emailsExtracted:tot.emails,emailsNormalized:tot.emails,invalidEmails:tot.invalid,duplicateEmails:tot.duplicates,qualifiedContacts:tot.qualified,contactsPersisted:tot.persisted,locationPriority:["Bengaluru","Bangalore","India","Remote"],formatsProcessed:[...new Set(ok.map(x=>x.type))],results:ok.filter(x=>x.emails>0).slice(0,20).map(x=>({source:x.resource.url,sourceType:x.type,emailsExtracted:x.emails,qualifiedContacts:x.qualified,persisted:x.persisted}))},null,2));
}
main().catch(e=>{console.error(JSON.stringify({status:"FAILED",feature:"PUBLIC_CONTACT_RESOURCE",error:e instanceof Error?e.message:String(e)},null,2));process.exitCode=1});
