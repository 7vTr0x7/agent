import { promises as dns } from "node:dns";
import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterIdentityCandidate,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";

const EMAIL = /[A-Z0-9._+\-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LI = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;
const RECRUITING = /(recruiter|recruiting|talent acquisition|talent partner|talent sourcer|technical sourcer|hiring manager|human resources|\bhr\b|careers?|staffing|hiring|people ops?|recruitment)/i;
const NON_RECRUITING = /(customer support|technical support|sales|billing|privacy|legal|security|press|media|partnerships?|helpdesk|procurement|accounting|finance|customer success|marketing)/i;
const MAILBOX = /^(careers?|jobs?|job|recruiting|recruitment|talent|talentacquisition|hr|people|hiring|staffing|joinus|workwithus|humanresources|resourcing|campushiring|campusrecruiting)$/i;
const CONCURRENCY = 4;
const TIMEOUT = 7000;
const EMPLOYER_TIMEOUT = 6000;
const RETRIES = 2;
const CIRCUIT_FAILURES = 3;
const CIRCUIT_COOLDOWN = 120_000;
const DEFAULT_QUERIES = 18;
const DEFAULT_TARGET = 12;
const EMPLOYER_PATHS = ["/careers","/career","/jobs","/job","/careers/jobs","/about/careers","/company/careers","/join-us","/joinus","/work-with-us","/workwithus","/talent","/recruiting","/hiring","/people","/team","/about","/about-us","/company","/contact","/contact-us"];

type SourceId = "google-jina"|"bing-jina"|"duckduckgo-jina"|"startpage-jina"|"ecosia-jina"|"jina-search"|"brave-api"|"mojeek-api";
interface Source { id: SourceId; url: string; headers?: Record<string,string>; }
interface Health { failures: number; openedAt?: number; }
interface Stats { attempted:number; succeeded:number; empty:number; timeouts:number; http403:number; http429:number; http5xx:number; otherHttpErrors:number; parseablePages:number; usefulPages:number; candidates:number; duplicateCandidates:number; lastError?:string; }
export interface PublicRecruiterSearchMetrics { queriesGenerated:number; queriesExecuted:number; queriesSkipped:number; rawPages:number; uniqueUrls:number; linkedinUrls:number; recruiterCandidates:number; duplicateCandidates:number; rejectedCandidates:number; sourceStats:Record<string,Stats>; circuitOpenSources:string[]; }
export interface PublicRecruiterSearchOptions { fetchText?: (url:string, timeoutMs?:number, signal?:AbortSignal)=>Promise<string|null>; maxQueries?:number; targetCandidates?:number; signal?:AbortSignal; }
const health = new Map<SourceId,Health>();
let jinaReaderNextAt = 0;
const jinaReaderSource = (id:SourceId) => id === "google-jina" || id === "bing-jina" || id === "duckduckgo-jina" || id === "startpage-jina" || id === "ecosia-jina";
const domainOf = (v:string) => v.trim().toLowerCase().replace(/^https?:\/\//,"").split("/")[0]?.replace(/^www\./,"") ?? "";
const emailOf = (v:string) => v.trim().toLowerCase();
const clean = (v:string) => v.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&#64;|&#x40;/gi,"@").replace(/&#46;|&#x2e;/gi,".").replace(/&quot;/gi,'"').replace(/\s+/g," ").trim();
const canonicalLI = (v:string) => { try { const u=new URL(v); const p=u.pathname.match(/^\/in\/([^/?#]+)/i)?.[1]; return p?`https://www.linkedin.com/in/${p.toLowerCase()}`:v; } catch { return v.toLowerCase().replace(/\/+$/,""); } };
const context = (text:string,i:number) => text.slice(Math.max(0,i-320),Math.min(text.length,i+320));
const plausiblePersonName = (name:string) => {
  const normalized = name.trim().toLowerCase();
  if (!normalized || normalized.length < 5 || normalized.length > 80) return false;
  if (/https?:\/\/|www\.|\b(?:url|source|search|results?|startpage|google|bing|duckduckgo|linkedin)\b/.test(normalized)) return false;
  const parts = normalized.split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts.length <= 5 && parts.every((part) => /^[a-z][a-z.'-]+$/.test(part));
};
export function isPlausibleRecruiterEmail(value:string):boolean { const e=emailOf(value), local=e.split("@")[0]??""; return !/%[0-9a-f]{2}/i.test(e) && !/^[^@]+%[^@]*@/i.test(e) && /^[a-z0-9][a-z0-9._+\-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(e) && !/^\d+$/.test(local) && !local.startsWith(".") && !local.endsWith(".") && !local.includes(".."); }
const recruitingMailbox = (e:string) => MAILBOX.test(emailOf(e).split("@")[0]?.replace(/[._+\-]/g,"")??"") || /^(recruit|talent|hr|hiring|career|jobs?)/i.test(emailOf(e).split("@")[0]??"");
const extractEmails = (text:string,domain:string) => [...new Map([...clean(text).matchAll(EMAIL)].map(m=>[emailOf(m[0]??""),{email:emailOf(m[0]??""),context:context(clean(text),m.index??0)}])).values()].filter(x=>isPlausibleRecruiterEmail(x.email) && x.email.split("@")[1]===domain && !NON_RECRUITING.test(x.context) && (RECRUITING.test(x.context)||recruitingMailbox(x.email)));
const extractLI = (text:string) => [...new Set((text.match(LI)??[]).map(canonicalLI))];
function sourceList(query:string):Source[] { const q=encodeURIComponent(query); const s:Source[]=[{id:"google-jina",url:`https://r.jina.ai/https://www.google.com/search?q=${q}&gbv=1`},{id:"bing-jina",url:`https://r.jina.ai/https://www.bing.com/search?q=${q}`},{id:"duckduckgo-jina",url:`https://r.jina.ai/https://html.duckduckgo.com/html/?q=${q}`},{id:"startpage-jina",url:`https://r.jina.ai/https://www.startpage.com/sp/search?query=${q}`},{id:"ecosia-jina",url:`https://r.jina.ai/https://www.ecosia.org/search?q=${q}`}]; if(process.env.JINA_API_KEY?.trim()) s.push({id:"jina-search",url:`https://s.jina.ai/${q}`,headers:{authorization:`Bearer ${process.env.JINA_API_KEY.trim()}`}}); if(process.env.BRAVE_SEARCH_API_KEY?.trim()) s.push({id:"brave-api",url:`https://api.search.brave.com/res/v1/web/search?q=${q}&count=20&extra_snippets=true`,headers:{"x-subscription-token":process.env.BRAVE_SEARCH_API_KEY.trim(),accept:"application/json"}}); if(process.env.MOJEEK_API_KEY?.trim()) s.push({id:"mojeek-api",url:`https://api.mojeek.com/search?q=${q}&api_key=${encodeURIComponent(process.env.MOJEEK_API_KEY.trim())}&fmt=json&t=20`,headers:{accept:"application/json"}}); return s; }
const stats = ():Record<string,Stats> => ({});
const stat = (all:Record<string,Stats>,id:string):Stats => all[id]??(all[id]={attempted:0,succeeded:0,empty:0,timeouts:0,http403:0,http429:0,http5xx:0,otherHttpErrors:0,parseablePages:0,usefulPages:0,candidates:0,duplicateCandidates:0});
const circuitOpen=(id:SourceId)=>{const h=health.get(id); if(!h?.openedAt)return false; if(Date.now()-h.openedAt>=CIRCUIT_COOLDOWN){health.set(id,{failures:0});return false;} return true;};
const success=(id:SourceId)=>health.set(id,{failures:0});
const failure=(id:SourceId)=>{const n=(health.get(id)?.failures??0)+1;health.set(id,n>=CIRCUIT_FAILURES?{failures:n,openedAt:Date.now()}:{failures:n});};
async function fetchDefault(url:string,timeout=TIMEOUT,signal?:AbortSignal,headers?:Record<string,string>):Promise<{text:string|null,status?:number,timedOut?:boolean,retryAfterMs?:number}> { const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout),abort=()=>c.abort(); signal?.addEventListener("abort",abort,{once:true}); try { const r=await fetch(url,{signal:c.signal,redirect:"follow",headers:{accept:"application/json,text/plain,text/html,application/xhtml+xml,*/*;q=0.8","user-agent":"job-agent-public-recruiter-discovery/7.0",...(headers??{})}}); const retryAfter=r.headers.get("retry-after");const retryAfterMs=retryAfter&&/^\d+(?:\.\d+)?$/.test(retryAfter)?Number(retryAfter)*1000:undefined; return {text:r.ok?await r.text():null,status:r.status,retryAfterMs}; } catch(e) { return {text:null,timedOut:e instanceof Error&&e.name==="AbortError"}; } finally { clearTimeout(timer);signal?.removeEventListener("abort",abort); } }
const retryable=(status?:number)=>status===408||status===425||status===429||(status!==undefined&&status>=500);
function directSearchUrl(source: Source): string | null {
  if (!jinaReaderSource(source.id)) return null;
  const prefix = "https://r.jina.ai/";
  return source.url.startsWith(prefix) ? source.url.slice(prefix.length) : null;
}
async function fetchSource(source:Source,fetcher:PublicRecruiterSearchOptions["fetchText"],signal:AbortSignal|undefined,s:Stats):Promise<string|null> {
  if(circuitOpen(source.id))return null;
  s.attempted++;
  for(let attempt=0;attempt<=RETRIES;attempt++){
    if(signal?.aborted)return null;
    if(jinaReaderSource(source.id) && !process.env.JINA_API_KEY?.trim()){
      const wait=Math.max(0,jinaReaderNextAt-Date.now());
      if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
      jinaReaderNextAt=Date.now()+3100;
    }
    let r=fetcher?{text:await fetcher(source.url,TIMEOUT,signal),status:200,retryAfterMs:undefined}:await fetchDefault(source.url,TIMEOUT,signal,source.headers);
    if(!r.text && !fetcher){
      const directUrl=directSearchUrl(source);
      if(directUrl) r=await fetchDefault(directUrl,TIMEOUT,signal);
    }
    if(r.text){s.succeeded++;success(source.id);return r.text;}
    if(r.timedOut)s.timeouts++;if(r.status===403)s.http403++;else if(r.status===429)s.http429++;else if((r.status??0)>=500)s.http5xx++;else if((r.status??0)>=400)s.otherHttpErrors++;
    if(!retryable(r.status)&&!r.timedOut)break;
    if(attempt===RETRIES)break;
    await new Promise(resolve=>setTimeout(resolve,Math.min(10000,Math.max(r.retryAfterMs??0,250*(2**attempt))+Math.floor(Math.random()*200))));
  }
  s.empty++;failure(source.id);return null;
}
async function mapLimit<T,R>(items:T[],limit:number,worker:(item:T)=>Promise<R>):Promise<R[]> { const out:R[]=new Array(items.length);let next=0; await Promise.all(Array.from({length:Math.min(Math.max(1,limit),items.length)},async()=>{while(true){const i=next++;if(i>=items.length)return;out[i]=await worker(items[i] as T);}}));return out; }
const technologies=(input:RecruiterDiscoveryInput)=>["react","react.js","next.js","nextjs","typescript","javascript","node.js","nodejs","frontend","front-end","full stack","full-stack","web"].filter(x=>`${input.jobTitle} ${input.jobDescription}`.toLowerCase().includes(x)).slice(0,4);
function queries(input:RecruiterDiscoveryInput,max:number):string[] { const company=input.companyName.trim(),domain=domainOf(input.companyDomain),title=input.jobTitle.trim(),location=input.location?.trim()||"India",tech=technologies(input)[0]??title; return [...new Set([`site:linkedin.com/in "${company}" "${title}" recruiter`,`site:linkedin.com/in "${company}" recruiter`,`site:linkedin.com/in "${company}" "technical recruiter"`,`site:linkedin.com/in "${company}" "talent acquisition"`,`site:linkedin.com/in "${company}" "head of talent"`,`site:linkedin.com/in "${company}" "head of global talent"`,`site:linkedin.com/in "${company}" "talent partner"`,`site:linkedin.com/in "${company}" "technical sourcer"`,`site:linkedin.com/in "${company}" "hiring manager" "${title}"`,`site:linkedin.com/in "${company}" recruiter "${location}"`,`site:linkedin.com/in recruiter "${title}" "${location}"`,`site:linkedin.com/in recruiter "${tech}" "${location}"`,`site:${domain} recruiter`,`site:${domain} "talent acquisition"`,`site:${domain} "technical recruiter"`,`site:${domain} (recruiting OR hiring OR careers OR talent)`,`"${company}" "${title}" recruiter "${location}"`,`"${company}" "${tech}" recruiter`,`"${company}" recruiter India`])].slice(0,Math.max(1,max)); }
async function employerPages(domain:string,signal?:AbortSignal,fetcher?:PublicRecruiterSearchOptions["fetchText"]):Promise<Array<{url:string,text:string}>> { const urls=EMPLOYER_PATHS.map(p=>`https://${domain}${p}`); const pages=await mapLimit(urls,CONCURRENCY,async url=>{const text=fetcher?await fetcher(url,EMPLOYER_TIMEOUT,signal):(await fetchDefault(url,EMPLOYER_TIMEOUT,signal)).text;return text?{url,text}:null;});return pages.filter((p):p is {url:string,text:string}=>Boolean(p)); }
function identity(url:string,text:string,domain:string):RecruiterIdentityCandidate|null { const i=text.toLowerCase().indexOf(url.toLowerCase()),snippet=text.slice(Math.max(0,i-360),Math.min(text.length,i+700)); if(!RECRUITING.test(snippet)||NON_RECRUITING.test(snippet))return null; const m=snippet.match(/([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s*(?:-|•|\||:)\s*([^|•]{3,120})/),name=m?.[1]?.trim(); if(!name || !plausiblePersonName(name))return null;const words=name.split(/\s+/);if(words.length<2||words.length>5||!words.every(w=>/^[A-Z][A-Za-z.'-]+$/.test(w)))return null; return {fullName:name,title:m?.[2]?.trim(),department:"recruiting",confidence:90,verified:false,verificationStatus:"identity_public_source",provider:"public-web",companyDomain:domain,recruitingContext:m?.[2]?.trim()||snippet.slice(0,300),discoveryEvidence:[snippet.slice(0,700)],discoveredAt:new Date(),linkedinProfileUrl:url,sources:[{url,type:"public_linkedin_search",confidence:90}]}; }
async function dohMx(domain:string):Promise<boolean|null>{ for(const endpoint of [`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`]){const c=new AbortController(),timer=setTimeout(()=>c.abort(),5000);try{const r=await fetch(endpoint,{signal:c.signal,headers:{accept:"application/dns-json"}});if(!r.ok)continue;const p=await r.json() as {Answer?:Array<{type?:number}>};return (p.Answer??[]).some(x=>x.type===15);}catch{}finally{clearTimeout(timer);}}return null; }
export class PublicRecruiterSearchProvider implements RecruiterDiscoveryProvider {
  readonly name="public-web"; private readonly fetcher?:PublicRecruiterSearchOptions["fetchText"];private readonly maxQueries:number;private readonly target:number;private readonly signal?:AbortSignal;
  constructor(options:PublicRecruiterSearchOptions={}){this.fetcher=options.fetchText;this.maxQueries=Math.max(1,options.maxQueries??(Number(process.env.RECRUITER_PUBLIC_SEARCH_MAX_QUERIES)||DEFAULT_QUERIES));this.target=Math.max(1,options.targetCandidates??(Number(process.env.RECRUITER_PUBLIC_SEARCH_TARGET_CANDIDATES)||DEFAULT_TARGET));this.signal=options.signal;}
  async discover(input:RecruiterDiscoveryInput):Promise<RecruiterDiscoveryResult>{
    const domain=domainOf(input.companyDomain),contacts=new Map<string,RecruiterDiscoveryResult["contacts"][number]>();const metrics:PublicRecruiterSearchMetrics={queriesGenerated:0,queriesExecuted:0,queriesSkipped:0,rawPages:0,uniqueUrls:0,linkedinUrls:0,recruiterCandidates:0,duplicateCandidates:0,rejectedCandidates:0,sourceStats:stats(),circuitOpenSources:[]};const q=queries(input,this.maxQueries);metrics.queriesGenerated=q.length;const seen=new Set<string>();
    for(const query of q){if(this.signal?.aborted)break;const sources=sourceList(query),runnable=sources.filter(s=>!circuitOpen(s.id));metrics.queriesSkipped+=sources.length-runnable.length;const pages=await mapLimit(runnable,CONCURRENCY,async source=>{const text=await fetchSource(source,this.fetcher,this.signal,stat(metrics.sourceStats,source.id));return text?{source,text}:null;});if(runnable.length)metrics.queriesExecuted++;
      for(const page of pages){if(!page)continue;const pageKey=`${page.source.id}:${page.text.slice(0,500)}`;if(seen.has(pageKey))continue;seen.add(pageKey);metrics.rawPages++;const text=clean(page.text),links=extractLI(page.text),emails=extractEmails(page.text,domain);metrics.linkedinUrls+=links.length;if(text.length>80)stat(metrics.sourceStats,page.source.id).parseablePages++;const ids=links.map(url=>identity(url,text,domain)).filter((x):x is RecruiterIdentityCandidate=>Boolean(x));if(ids.length||emails.length)stat(metrics.sourceStats,page.source.id).usefulPages++;
        for(const c of ids){const key=`profile:${c.linkedinProfileUrl?.toLowerCase()}`,existing=contacts.get(key);if(existing){metrics.duplicateCandidates++;stat(metrics.sourceStats,page.source.id).duplicateCandidates++;existing.confidence=Math.min(100,Math.max(existing.confidence??0,c.confidence??0)+1);existing.sources=[...existing.sources,...c.sources];existing.discoveryEvidence=[...new Set([...(existing.discoveryEvidence??[]),...(c.discoveryEvidence??[])])].slice(0,10);}else{contacts.set(key,c);stat(metrics.sourceStats,page.source.id).candidates++;}}
        for(const e of emails){const li=links.find(url=>text.toLowerCase().includes(url.toLowerCase())),key=li?`profile:${li}`:`email:${e.email}`,existing=contacts.get(key),src={type:page.source.id,confidence:li?97:recruitingMailbox(e.email)?94:92};if(existing){metrics.duplicateCandidates++;stat(metrics.sourceStats,page.source.id).duplicateCandidates++;(existing as RecruiterContactCandidate).email=e.email;existing.linkedinProfileUrl=existing.linkedinProfileUrl??li;existing.sources=[...existing.sources,src];existing.discoveryEvidence=[...new Set([...(existing.discoveryEvidence??[]),e.context.slice(0,560)])].slice(0,10);continue;}contacts.set(key,{email:e.email,title:"Recruiting contact from public source",department:"recruiting",confidence:src.confidence,verified:false,verificationStatus:"unverified_public_source",provider:this.name,linkedinProfileUrl:li,companyDomain:domain,recruitingContext:e.context,discoveryEvidence:[e.context.slice(0,560)],sources:[src]});stat(metrics.sourceStats,page.source.id).candidates++;}
      }
      const sourceTypes=new Set([...contacts.values()].flatMap(c=>c.sources.map(s=>s.type).filter(Boolean)));if(contacts.size>=this.target&&sourceTypes.size>=3)break;
    }
    for(const page of await employerPages(domain,this.signal,this.fetcher)){if(this.signal?.aborted)break;const text=clean(page.text),links=extractLI(page.text),emails=extractEmails(page.text,domain);for(const li of links){const c=identity(li,text,domain);if(!c)continue;const key=`profile:${li}`;if(contacts.has(key)){metrics.duplicateCandidates++;continue;}contacts.set(key,c);}for(const e of emails){if(recruitingMailbox(e.email)) continue;const key=`email:${e.email}`;if(contacts.has(key)){metrics.duplicateCandidates++;continue;}contacts.set(key,{email:e.email,title:"Recruiting contact from employer page",department:"recruiting",confidence:95,verified:false,verificationStatus:"unverified_public_source",provider:this.name,companyDomain:domain,recruitingContext:e.context,discoveryEvidence:[e.context.slice(0,560)],sources:[{url:page.url,type:"employer_recruiting_page",confidence:95}]});}}
    metrics.recruiterCandidates=contacts.size;metrics.uniqueUrls=seen.size;metrics.circuitOpenSources=sourceList("").filter(s=>circuitOpen(s.id)).map(s=>s.id);return{provider:this.name,contacts:[...contacts.values()].sort((a,b)=>(b.confidence??0)-(a.confidence??0)),discoveredAt:new Date(),metrics};
  }
  async verify(email:string):Promise<RecruiterVerificationResult>{const normalized=emailOf(email);if(!isPlausibleRecruiterEmail(normalized))return{email:normalized,verified:false,status:"INVALID",confidence:0};const domain=normalized.split("@")[1]??"";try{const mx=await dns.resolveMx(domain);if(mx.length)return{email:normalized,verified:false,status:"LIKELY",confidence:75,verificationEvidence:[{provider:"public-web-mx",status:"LIKELY",confidence:75,mailboxLevel:false,source:"DNS MX"}]};return{email:normalized,verified:false,status:"INVALID",confidence:0};}catch{const result=await dohMx(domain);if(result===true)return{email:normalized,verified:false,status:"LIKELY",confidence:75,verificationEvidence:[{provider:"public-web-doh-mx",status:"LIKELY",confidence:75,mailboxLevel:false,source:"DNS-over-HTTPS MX"}]};if(result===false)return{email:normalized,verified:false,status:"INVALID",confidence:0};return{email:normalized,verified:false,status:"UNVERIFIED",confidence:0};}}
}
