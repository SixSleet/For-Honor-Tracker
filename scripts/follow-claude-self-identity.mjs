/* Privacy-safe identity/entitlement validation.
 * Resolves the stored session profile to an account userId internally and only
 * logs booleans/counts. No identifier values are emitted.
 */
const BRANCH='chatgpt-follow-claude-endpoints';
const UBI='https://public-ubiservices.ubi.com';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const FH=new Set(['c2294cd6-bd01-4f19-81e9-4e5d32cb763a','882ad5b5-f549-44a1-a434-c465d22fe4bf']);
const T=9000;const log=s=>console.log(`[FH_SELF_IDENTITY] ${s}`);
async function sess(){const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return b}}catch{};return null}
async function get(url,h){try{const r=await fetch(url,{headers:h,signal:AbortSignal.timeout(T)});let b=null;try{b=await r.json()}catch{};return{status:r.status,body:b}}catch{return{status:0,body:null}}}
async function main(){if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}const s=await sess();log(`session_available=${Boolean(s?.ticket)} profile_available=${Boolean(s?.profileId)}`);if(!s?.ticket||!s?.profileId)return;const h={Accept:'application/json','Ubi-AppId':APP,'Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`};const q=encodeURIComponent(s.profileId);let profiles=[];for(const[label,url]of [['profileId',`${UBI}/v2/profiles?profileId=${q}`],['profileIds',`${UBI}/v2/profiles?profileIds=${q}`]]){const x=await get(url,h);const arr=Array.isArray(x.body?.profiles)?x.body.profiles:[];log(`${label}: status=${x.status} profile_count=${arr.length} has_userId=${arr.some(p=>Boolean(p?.userId))}`);if(arr.length)profiles=arr}
const userId=profiles.find(p=>p?.profileId===s.profileId)?.userId||profiles.find(p=>p?.userId)?.userId||null;log(`account_userId_resolved=${Boolean(userId)} differs_from_profileId=${Boolean(userId&&userId!==s.profileId)}`);if(!userId)return;for(const[label,id]of [['stored-profile',s.profileId],['resolved-user',userId]]){const x=await get(`${UBI}/v1/profiles/gamesplayed?profileIds=${encodeURIComponent(id)}`,h);const games=Array.isArray(x.body?.gamesPlayed)?x.body.gamesPlayed:[];log(`${label}: status=${x.status} games_count=${games.length} has_known_for_honor=${games.some(g=>FH.has(g?.spaceId))} has_crossplay=${games.some(g=>g?.spaceId==='c2294cd6-bd01-4f19-81e9-4e5d32cb763a')} has_legacy=${games.some(g=>g?.spaceId==='882ad5b5-f549-44a1-a434-c465d22fe4bf')}`)}}
main().catch(e=>log(`unexpected_error=${e?.name||'Error'}`));
