import { DeterministicJobMatcher } from "./DeterministicJobMatcher";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";
const profile:CandidateProfile={id:"candidate-1",yearsExperience:3,skills:["React","Next.js","TypeScript","Node.js"],targetTitles:["Frontend Engineer","Full Stack Developer"],location:"India",currentCompensationLpa:6.5};
const now=new Date("2026-09-12T00:00:00Z"),matcher=new DeterministicJobMatcher({now});
function job(description:string,title="Frontend Engineer",o:Partial<JobOpportunity>={}):JobOpportunity{return{id:"j",canonicalId:"c",canonicalUrl:"https://example.com/j",title,companyName:"Example",location:"Bengaluru",country:"India",workplaceType:"hybrid",employmentType:"full-time",description,postedAt:new Date("2026-09-10T00:00:00Z"),sourceUpdatedAt:null,lastSeenAt:now,closedAt:null,status:"ACTIVE",createdAt:now,updatedAt:now,...o};}
const run=(d:string,t="Frontend Engineer",o:Partial<JobOpportunity>={})=>matcher.evaluate(job(d,t,o),profile);
describe("matcher systematic calibration regressions",()=>{
 it("rejects Vue-primary frontend",()=>expect(run("Deep knowledge of Vue.js is required.","Software Development Engineer II - Frontend").decision).toBe("REJECT"));
 it("rejects Angular-primary frontend",()=>expect(run("Must have deep knowledge of Angular.").decision).toBe("REJECT"));
 it("rejects Svelte-primary frontend",()=>expect(run("Primary frontend framework is Svelte; strong Svelte experience is essential.").decision).toBe("REJECT"));
 it("keeps React frontend eligible",()=>expect(run("React and TypeScript are required.").decision).toBe("APPLY"));
 it("keeps React Node full-stack eligible",()=>expect(run("React and Next.js customer-facing UI plus Node.js APIs.","Full Stack Engineer").decision).toBe("APPLY"));
 it("classifies backend integrations as backend",()=>{const r=run("Backend integrations and API-based systems with message queues. React dashboard work is incidental.","Backend Integrations Engineer",{location:"Worldwide",country:null,workplaceType:"remote"});expect(r.technicalOrientation).toBe("BACKEND_FOCUSED");expect(r.decision).not.toBe("APPLY");});
 it("rejects primary React Native",()=>expect(run("React Native, Expo and Android/iOS mobile development.","React Native Developer").decision).toBe("REJECT"));
 it("allows React web with optional React Native",()=>expect(run("React and Next.js web applications. React Native is optional.").decision).toBe("APPLY"));
 it("reviews explicit 4+ years mismatch",()=>expect(run("4+ years strong experience required.").decision).toBe("REVIEW"));
 it("reviews 4-6+ years",()=>expect(run("React, Next.js and Python. 4–6+ years.","Full Stack Engineer").decision).toBe("REVIEW"));
 it("rejects 7+ years",()=>expect(run("React and TypeScript. 7+ years required.").decision).toBe("REJECT"));
 it("rejects Remote USA from description with null location",()=>{const r=run("Location: Remote, USA. React and Node.js.","Full Stack Developer",{location:null,country:null,workplaceType:"remote"});expect(r.geography).toBe("REMOTE_RESTRICTED");expect(r.decision).toBe("REJECT");});
 it("rejects Remote UK from description with null location",()=>{const r=run("Remote within the UK only. React and TypeScript.","Frontend Engineer",{location:null,country:null,workplaceType:"remote"});expect(r.geography).toBe("REMOTE_RESTRICTED");expect(r.decision).toBe("REJECT");});
 it("does not treat worldwide remote as India",()=>{const r=run("React and TypeScript. Worldwide remote.","Frontend Engineer",{location:"Worldwide",country:null,workplaceType:"remote"});expect(r.geography).toBe("REMOTE_WORLDWIDE");expect(r.decision).toBe("REVIEW");});
 it("Bangalore is Bengaluru",()=>expect(run("React and TypeScript.","Frontend Engineer",{location:"Bangalore, India",country:"India",workplaceType:"onsite"}).geography).toBe("BENGALURU"));
 it("rejects historical 2023",()=>expect(run("React and TypeScript.","Frontend Engineer",{postedAt:new Date("2023-08-01T00:00:00Z")}).decision).toBe("REJECT"));
 it("rejects excluded company",()=>expect(run("React and TypeScript.","Frontend Engineer",{companyName:"Octopus Technologies"}).decision).toBe("REJECT"));
 it("mandatory competing framework overrides React keyword volume",()=>expect(run("React, Next.js and TypeScript. Must have deep knowledge of Vue.js.").decision).toBe("REJECT"));
});
