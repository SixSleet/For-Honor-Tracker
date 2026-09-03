/* Privacy-safe test of account-level Ubisoft identity for For Honor title auth.
 * Resolves the stored session profile to a userId internally, then tests the
 * two proven title routes with Ubi-ProfileId/Ubi-UserId combinations. Neither
 * identifier nor any credential/response value is logged.
 */
const BRANCH='chatgpt-follow-claude-endpoints';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const BUILD='CERT_PC_70.713_C9831255_D485915_S20473';
const SANDBOX='SM_PC_LNCH_A';
const FH=new Set([SPACE,'882ad5b5-f549-44a1-a434-c465d22fe4bf']);
const T=9000;
const log=s=>console.log(`[FH_ACCOUNT_TITLE_AUTH] ${s}`);
async function session(){const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return b}}catch{};return null}
async function json(url,h,opts={}){try{const r=await fetch(url,{headers:h,redirect:'manual',signal:AbortSignal.timeout(T),...opts});let b=null;try{b=await r.json()}catch{};return{status:r.status,body:b,allow:r.headers.get('allow')}}catch(e){return{status:0,body:{message:e?.name||'Error'},allow:null}}}
function clean(v){return String(v??'-').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<uuid>').replace(/\b\d{12,}\b/g,'<id>').slice(0,180)}
function result(label,x){log(`${label}: status=${x.status} allow=${clean(x.allow)} code=${clean(x.body?.errorCode)} context=${clean(x.body?.errorContext)} resource=${clean(x.body?.resource)} message=${clean(x.body?.message)}`)}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await session();log(`session_available=${Boolean(s?.ticket)} profile_available=${Boolean(s?.profileId)}`);if(!s?.ticket||!s?.profileId)return;
 const base={'Accept':'application/json','Content-Type':'application/json','Ubi-AppId':APP,'X-Platform-AppId':APP,'Ubi-AppBuildId':BUILD,'Ubi-Populations':SANDBOX,'Ubi-SandboxId':SANDBOX,'Ubi-LocaleCode':'en-US','Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`};
 let profiles=[];
 for(const q of [`profileId=${encodeURIComponent(s.profileId)}`,`profileIds=${encodeURIComponent(s.profileId)}`]){const x=await json(`${UBI}/v2/profiles?${q}`,base);const a=Array.isArray(x.body?.profiles)?x.body.profiles:[];if(a.length)profiles=a;log(`identity_lookup: status=${x.status} count=${a.length} has_userId=${a.some(p=>Boolean(p?.userId))}`)}
 const userId=profiles.find(p=>p?.profileId===s.profileId)?.userId||profiles.find(p=>p?.userId)?.userId||null;
 log(`userId_resolved=${Boolean(userId)} differs_from_profileId=${Boolean(userId&&userId!==s.profileId)}`);
 if(userId){for(const[label,id]of [['profile',s.profileId],['user',userId]]){const g=await json(`${UBI}/v1/profiles/gamesplayed?profileIds=${encodeURIComponent(id)}`,base);const games=Array.isArray(g.body?.gamesPlayed)?g.body.gamesPlayed:[];log(`${label}_gamesplayed: status=${g.status} game_count=${games.length} has_for_honor=${games.some(x=>FH.has(x?.spaceId))}`)}}
 const login=`${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/herologin/public/v1/login`;
 const rank=`${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/heroranking/public/v1/player`;
 const variants=[
   ['session-profile',{'Ubi-ProfileId':s.profileId}],
   ...(userId?[
     ['user-as-profile',{'Ubi-ProfileId':userId}],
     ['user-header',{'Ubi-ProfileId':s.profileId,'Ubi-UserId':userId}],
     ['user-only',{'Ubi-UserId':userId}],
     ['user-both',{'Ubi-ProfileId':userId,'Ubi-UserId':userId}],
   ]:[]),
 ];
 for(const[name,extra]of variants){const h={...base,...extra};result(`${name}-login-get`,await json(login,h));result(`${name}-login-post-empty`,await json(login,h,{method:'POST',body:'{}'}));result(`${name}-rank`,await json(rank,h));if(userId){result(`${name}-rank-user-query`,await json(`${rank}?userId=${encodeURIComponent(userId)}&skillFamily=1&playlistId=22`,h));result(`${name}-rank-profile-query`,await json(`${rank}?profileId=${encodeURIComponent(s.profileId)}&skillFamily=1&playlistId=22`,h));}}
}
main().catch(e=>log(`unexpected_error=${clean(e?.name||'Error')}`));
