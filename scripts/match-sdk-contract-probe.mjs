/* Privacy-safe, low-volume test of generic Ubi /profiles/{self}/matches.
 * Query field names are derived from public Ubisoft matchmaking documentation.
 * Never prints profile/session identifiers or response data beyond schema/error metadata.
 */
const BRANCH='chatgpt-ranked-history-research';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const T=12000;
const log=s=>console.log(`[FH_MATCH_SDK] ${s}`);
async function sess(){
 if(process.env.UBISOFT_TICKET&&process.env.UBISOFT_PROFILE_ID)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||'',profileId:process.env.UBISOFT_PROFILE_ID};
 const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
 if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket&&b?.profileId)return{ticket:b.ticket,sessionId:b.sessionId||'',profileId:b.profileId}}}catch{}
 const uu=process.env.UPSTASH_REDIS_REST_URL,ut=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(uu&&ut)try{const r=await fetch(uu,{method:'POST',headers:{Authorization:`Bearer ${ut}`,'Content-Type':'application/json'},body:JSON.stringify(['GET','ubisoft:session']),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();const x=b?.result?JSON.parse(b.result):null;if(x?.ticket&&x?.profileId)return{ticket:x.ticket,sessionId:x.sessionId||'',profileId:x.profileId}}}catch{}
 return null;
}
function meta(x){if(!x||typeof x!=='object')return 'non-json';const keys=Object.keys(x).sort().join(',');const ec=typeof x.errorContext==='string'?x.errorContext:'-';const code=x.errorCode??'-';const msg=typeof x.message==='string'?x.message.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,'<uuid>').slice(0,220):'-';return `keys=${keys||'-'} errorContext=${ec} errorCode=${code} message=${msg}`}
async function req(label,url,h){try{const r=await fetch(url,{headers:h,signal:AbortSignal.timeout(T)});const text=await r.text();let b=null;try{b=JSON.parse(text)}catch{};log(`${label}: status=${r.status} ${meta(b)}`)}catch(e){log(`${label}: network_error=${e?.name||'Error'}`)}}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await sess();log(`session_available=${Boolean(s?.ticket)} profile_available=${Boolean(s?.profileId)}`);if(!s?.ticket||!s?.profileId)return;
 const h={Accept:'application/json','Ubi-AppId':APP,'X-Platform-AppId':APP,'Ubi-SessionId':s.sessionId||'','Ubi-LocaleCode':'en-US',Authorization:`Ubi_v1 t=${s.ticket}`};
 const base=`${UBI}/v1/profiles/${encodeURIComponent(s.profileId)}/matches`;
 const fake='00000000-0000-4000-8000-000000000000';
 const qs=[
  ['matchType-spaceIds',new URLSearchParams({matchType:'MATCHMAKING_PVP',spaceIds:SPACE})],
  ['matchType-spaceId',new URLSearchParams({matchType:'MATCHMAKING_PVP',spaceId:SPACE})],
  ['matchType-spaceIds-matchIds',new URLSearchParams({matchType:'MATCHMAKING_PVP',spaceIds:SPACE,matchIds:fake})],
  ['matchmakingType-matchType-spaceIds',new URLSearchParams({matchmakingType:'MATCHMAKING_PVP',matchType:'MATCHMAKING_PVP',spaceIds:SPACE})],
  ['platform-matchType-spaceIds',new URLSearchParams({platform:'PC',matchType:'MATCHMAKING_PVP',spaceIds:SPACE})],
 ];
 for(const [label,q] of qs)await req(label,`${base}?${q}`,h);
 // Related documented Harbour route: useful control for whether this account/service accepts the same query vocabulary.
 const harbour=`${UBI}/v1/profiles/${encodeURIComponent(s.profileId)}/global/harboursocial/matchmaking`;
 await req('harbour-control',`${harbour}?${new URLSearchParams({matchType:'MATCHMAKING_PVP',spaceIds:SPACE})}`,h);
}
main().catch(()=>log('unexpected_error=redacted'));
