/* Privacy-safe title-auth header matrix based on live public Storm config.
 * Tests only the two proven routes. Logs statuses/error shape, never account or
 * credential values.
 */
const BRANCH='chatgpt-follow-claude-endpoints';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const BUILD='CERT_PC_70.713_C9831255_D485915_S20473';
const T=9000;
const log=s=>console.log(`[FH_TITLE_HEADERS] ${s}`);
async function sess(){const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return b}}catch{};return null}
function clean(v){return String(v??'-').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<uuid>').slice(0,180)}
async function req(label,url,h,method='GET',body){try{const r=await fetch(url,{method,headers:h,body,redirect:'manual',signal:AbortSignal.timeout(T)});let b=null;try{b=await r.json()}catch{};log(`${label}: method=${method} status=${r.status} code=${clean(b?.errorCode)} context=${clean(b?.errorContext)} resource=${clean(b?.resource)} message=${clean(b?.message)}`);return r.status}catch(e){log(`${label}: network_error=${e?.name||'Error'}`);return 0}}
async function main(){if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}const s=await sess();log(`session_available=${Boolean(s?.ticket)} profile_available=${Boolean(s?.profileId)}`);if(!s?.ticket)return;const login=`${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/herologin/public/v1/login`;const rank=`${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/heroranking/public/v1/player`;
const variants=[
 ['minimal',{}],
 ['hero-sandbox',{'Ubi-SandboxId':'HERO_PC_LNCH_A','Ubi-Populations':'HERO_PC_LNCH_A'}],
 ['storm-sandbox',{'Ubi-SandboxId':'SM_PC_LNCH_A','Ubi-Populations':'SM_PC_LNCH_A'}],
 ['storm-pop-only',{'Ubi-Populations':'SM_PC_LNCH_A'}],
 ['storm-sandbox-only',{'Ubi-SandboxId':'SM_PC_LNCH_A'}],
 ['mixed-hero-sandbox-storm-pop',{'Ubi-SandboxId':'HERO_PC_LNCH_A','Ubi-Populations':'SM_PC_LNCH_A'}],
 ['mixed-storm-sandbox-hero-pop',{'Ubi-SandboxId':'SM_PC_LNCH_A','Ubi-Populations':'HERO_PC_LNCH_A'}]
];
for(const[name,extra]of variants){const h={Accept:'application/json','Content-Type':'application/json','Ubi-AppId':APP,'X-Platform-AppId':APP,'Ubi-AppBuildId':BUILD,'Ubi-LocaleCode':'en-US','Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`,...(s.profileId?{'Ubi-ProfileId':s.profileId}:{}),...extra};await req(`${name}-login-get`,login,h);await req(`${name}-login-post`,login,h,'POST','{}');await req(`${name}-rank`,rank,h)}
}
main().catch(e=>log(`unexpected_error=${e?.name||'Error'}`));
