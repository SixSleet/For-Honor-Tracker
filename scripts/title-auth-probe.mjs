/* Privacy-safe For Honor title-auth probe.
 * Uses the existing server-side Ubisoft Connect session internally.
 * Logs only booleans, public game config values, statuses, response key names,
 * and sanitized generic errors. No account/profile/session/token values.
 */
const BRANCH='chatgpt-ranked-history-research';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const LEGACY='882ad5b5-f549-44a1-a434-c465d22fe4bf';
const GAME_APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const T=12000;
const log=s=>console.log(`[FH_TITLE_AUTH] ${s}`);

function clean(s){return String(s)
 .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,'<uuid>')
 .replace(/\b\d{12,}\b/g,'<id>')
 .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'<email>')
 .replace(/(Ubi_v1|rm_v1|Bearer)\s+(?:t=)?[^\s&"']+/gi,'$1 <redacted>')
 .slice(0,500)}

async function sess(){
 if(process.env.UBISOFT_TICKET)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||'',profileId:null};
 const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
 if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return{ticket:b.ticket,sessionId:b.sessionId||'',profileId:b.profileId||null}}}catch{}
 const uu=process.env.UPSTASH_REDIS_REST_URL,ut=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(uu&&ut)try{const r=await fetch(uu,{method:'POST',headers:{Authorization:`Bearer ${ut}`,'Content-Type':'application/json'},body:JSON.stringify(['GET','ubisoft:session']),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();const x=b?.result?JSON.parse(b.result):null;if(x?.ticket)return{ticket:x.ticket,sessionId:x.sessionId||'',profileId:x.profileId||null}}}catch{}
 return null;
}
function shape(text){try{const b=JSON.parse(text);return{body:b,keys:b&&typeof b==='object'&&!Array.isArray(b)?Object.keys(b).sort().slice(0,50):[]}}catch{return{body:null,keys:[]}}}
function publicBuild(params){const f=params?.parameters?.['fh-configuration']?.fields||{};const candidates=['application_build_id_pc','applicationBuildIdPc','build_id_pc'];for(const k of candidates)if(typeof f[k]==='string'&&f[k])return f[k];return null}
function publicPopulation(params){
 const f=params?.parameters?.['fh-clientSettings']?.fields||{};
 for(const [k,v] of Object.entries(f))if(/population/i.test(k)&&typeof v==='string'&&v&&v.length<200)return v;
 return 'US_EMPTY_VALUE';
}
async function request(label,url,options){
 try{const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(T),...options});const text=(await r.text()).slice(0,400000);const s=shape(text);const names=[...r.headers.keys()].filter(k=>/(auth|token|ticket|session|ubi)/i.test(k)).sort();log(`${label}: status=${r.status} keys=${s.keys.join(',')||'-'} relevant_headers=${names.join(',')||'-'}`);if(s.body&&!r.ok){const msg=typeof s.body.message==='string'?s.body.message:'';const ec=typeof s.body.errorCode!=='undefined'?String(s.body.errorCode):'';const ctx=typeof s.body.errorContext==='string'?s.body.errorContext:'';const resource=typeof s.body.resource==='string'?s.body.resource:'';if(msg||ec||ctx||resource)log(`${label}: errorCode=${clean(ec||'-')} context=${clean(ctx||'-')} message=${clean(msg||'-')} resource=${clean(resource||'-')}`)}return{r,text,body:s.body};}catch(e){log(`${label}: network_error=${clean(e?.name||'Error')}`);return null}
}
function tokenCandidates(body){if(!body||typeof body!=='object')return[];const out=[];for(const [k,v] of Object.entries(body)){if(typeof v==='string'&&v.length>20&&/(token|ticket|auth|credential)/i.test(k))out.push({key:k,value:v});}return out.slice(0,10)}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await sess();log(`session_available=${Boolean(s?.ticket)} profile_available=${Boolean(s?.profileId)}`);if(!s?.ticket)return;
 const baseHeaders={Accept:'application/json','Content-Type':'application/json','Ubi-AppId':GAME_APP,'X-Platform-AppId':GAME_APP,'Ubi-SessionId':s.sessionId||'','Ubi-LocaleCode':'en-US',Authorization:`Ubi_v1 t=${s.ticket}`,'User-Agent':'UbiServices_SDK_PC64'};
 const cfg=await request('space-parameters',`${UBI}/v1/spaces/${SPACE}/parameters`,{headers:baseHeaders});
 const build=publicBuild(cfg?.body);const population=publicPopulation(cfg?.body);
 log(`public_build_available=${Boolean(build)} population_header_available=${Boolean(population)}`);
 if(build)log(`public_build=${clean(build)}`);
 log(`population_header=${clean(population)}`);

 if(s.profileId){
  const gp=await request('self-gamesplayed',`${UBI}/v1/profiles/gamesplayed?profileIds=${encodeURIComponent(s.profileId)}`,{headers:baseHeaders});
  const games=Array.isArray(gp?.body?.gamesPlayed)?gp.body.gamesPlayed:[];
  const owns=games.some(g=>g&&[SPACE,LEGACY].includes(g.spaceId));
  log(`operator_has_for_honor_space=${owns}`);
 }

 const full={...baseHeaders,'Ubi-Populations':population||'US_EMPTY_VALUE',...(build?{'Ubi-AppBuildId':build}:{})};
 if(s.profileId)full['Ubi-ProfileId']=s.profileId;
 const login=`${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/herologin/public/v1/login`;
 const variants=[
  ['get-full','GET',full,undefined],
  ['post-empty-full','POST',full,'{}'],
  ['post-space-full','POST',full,JSON.stringify({spaceId:SPACE})],
  ['post-platform-full','POST',full,JSON.stringify({platform:'PC'})],
  ['post-context-full','POST',full,JSON.stringify({spaceId:SPACE,platform:'PC',sandbox:'HERO_PC_LNCH_A'})],
  ['post-empty-no-profile-header','POST',Object.fromEntries(Object.entries(full).filter(([k])=>k.toLowerCase()!=='ubi-profileid')),'{}'],
 ];
 let titleTokens=[];
 for(const [name,method,headers,body] of variants){const x=await request(`login-${name}`,login,{method,headers,...(body?{body}:{})});const c=tokenCandidates(x?.body);log(`login-${name}: credential_like_fields=${c.map(z=>z.key).join(',')||'-'}`);if(c.length&&!titleTokens.length)titleTokens=c;}

 const rank=`${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/heroranking/public/v1/player?skillFamily=1&playlistId=22`;
 await request('rank-connect-ticket',rank,{headers:full});
 for(let i=0;i<Math.min(titleTokens.length,4);i++){
  const t=titleTokens[i];
  for(const [scheme,auth] of [['raw',t.value],['bearer',`Bearer ${t.value}`],['ubi',`Ubi_v1 t=${t.value}`]]){
   const h={...full,Authorization:auth};
   await request(`rank-title-credential-${i+1}-${scheme}`,rank,{headers:h});
  }
 }
}
main().catch(()=>log('unexpected_error=redacted'));
