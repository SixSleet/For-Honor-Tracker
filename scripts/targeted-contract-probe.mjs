/* Targeted, privacy-safe contract discovery.
 * Uses only GET requests. Logs statuses/schemas/errors with UUIDs and long ids redacted.
 * No usernames/profile ids/tickets/session ids are ever printed.
 */
const BRANCH='chatgpt-ranked-history-research';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const GAME_APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const SYNTH_MATCH='00000000-0000-4000-8000-000000000001';
const T=12000;
const log=s=>console.log(`[FH_TARGET_CONTRACT] ${s}`);
function clean(s){return String(s).replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,'<uuid>').replace(/\b\d{12,}\b/g,'<id>').replace(/(Ubi_v1|rm_v1)\s+t=[^\s&"']+/gi,'$1 t=<redacted>').slice(0,400)}
async function sess(){
 if(process.env.UBISOFT_TICKET)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||'',profileId:null};
 const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
 if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return{ticket:b.ticket,sessionId:b.sessionId||'',profileId:b.profileId||null}}}catch{}
 return null;
}
function shape(text){try{const b=JSON.parse(text);const top=b&&typeof b==='object'&&!Array.isArray(b)?Object.keys(b).sort():[];const paths=new Set();function w(v,p='',d=0){if(d>4||v==null||typeof v!=='object')return;if(Array.isArray(v)){paths.add(`${p}[${v.length}]`);if(v[0]!==undefined)w(v[0],`${p}[]`,d+1);return}for(const k of Object.keys(v).sort().slice(0,80)){const q=p?`${p}.${k}`:k;paths.add(q);w(v[k],q,d+1)}}w(b);return{body:b,top:top.slice(0,30),paths:[...paths].slice(0,100)}}catch{return{body:null,top:[],paths:[]}}}
async function probe(label,url,h){try{const r=await fetch(url,{headers:h,redirect:'manual',signal:AbortSignal.timeout(T)});const text=(await r.text()).slice(0,300000);const s=shape(text);log(`${label}: status=${r.status} topKeys=${s.top.join(',')||'-'} schema=${s.paths.join('|')||'-'}`);if(s.body&&!r.ok){const msg=typeof s.body.message==='string'?s.body.message:'';const ctx=typeof s.body.errorContext==='string'?s.body.errorContext:'';const resource=typeof s.body.resource==='string'?s.body.resource:'';const more=typeof s.body.moreInfo==='string'?s.body.moreInfo:'';if(ctx||msg||resource||more)log(`${label}: context=${clean(ctx||'-')} message=${clean(msg||'-')} resource=${clean(resource||'-')} moreInfo=${clean(more||'-')}`)}return r.status}catch(e){log(`${label}: network_error=${e?.name||'Error'}`);return null}}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await sess();log(`session_available=${Boolean(s?.ticket)} profile_available=${Boolean(s?.profileId)}`);if(!s?.ticket)return;
 const h={Accept:'application/json','Ubi-AppId':GAME_APP,'Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`};
 const title=`${UBI}/v1/spaces/${SPACE}/title/hero/hero-live`;
 const rankTests=[
   ['ranking-v1-rank',`${title}/heroranking/public/v1/rank?skillFamily=1&playlistId=22`],
   ['ranking-v1-player',`${title}/heroranking/public/v1/player?skillFamily=1&playlistId=22`],
   ['ranking-v1-profile',`${title}/heroranking/public/v1/profile?skillFamily=1&playlistId=22`],
   ['ranking-v2-rank',`${title}/heroranking/public/v2/rank?skillFamily=1&playlistId=22`],
   ['ranking-v2-player',`${title}/heroranking/public/v2/player?skillFamily=1&playlistId=22`],
   ['ranking-v2-profile',`${title}/heroranking/public/v2/profile?skillFamily=1&playlistId=22`],
   ['skillrating-rating',`${title}/skillrating/public/v1/rating?skillFamily=1&playlistId=22`],
   ['skillrating-skill',`${title}/skillrating/public/v1/skill?skillFamily=1&playlistId=22`],
   ['skillrating-player',`${title}/skillrating/public/v1/player?skillFamily=1&playlistId=22`],
   ['leaderboard-leaderboard',`${title}/heroleaderboard/public/v1/leaderboard?skillFamily=1&playlistId=22`],
   ['leaderboard-entries',`${title}/heroleaderboard/public/v1/entries?skillFamily=1&playlistId=22`],
   ['leaderboard-player',`${title}/heroleaderboard/public/v1/player?skillFamily=1&playlistId=22`],
 ];
 if(s.profileId){
   rankTests.push(
    ['ranking-v1-profiles-self',`${title}/heroranking/public/v1/profiles/${encodeURIComponent(s.profileId)}?skillFamily=1&playlistId=22`],
    ['ranking-v2-profiles-self',`${title}/heroranking/public/v2/profiles/${encodeURIComponent(s.profileId)}?skillFamily=1&playlistId=22`],
    ['skillrating-profiles-self',`${title}/skillrating/public/v1/profiles/${encodeURIComponent(s.profileId)}?skillFamily=1&playlistId=22`]
   );
 }
 for(const [label,url] of rankTests)await probe(label,url,h);

 const matchTests=[
   ['space-matches-base',`${UBI}/v1/spaces/${SPACE}/matches`],
   ['space-matches-matchId',`${UBI}/v1/spaces/${SPACE}/matches?matchId=${SYNTH_MATCH}`],
   ['space-matches-matchIds',`${UBI}/v1/spaces/${SPACE}/matches?matchIds=${SYNTH_MATCH}`],
 ];
 if(s.profileId){const p=`${UBI}/v1/profiles/${encodeURIComponent(s.profileId)}/matches`;matchTests.push(
   ['profile-matches-matchId',`${p}?matchId=${SYNTH_MATCH}`],
   ['profile-matches-matchIds',`${p}?matchIds=${SYNTH_MATCH}`],
   ['profile-matches-space-matchId',`${p}?spaceId=${SPACE}&matchId=${SYNTH_MATCH}`],
   ['profile-matches-space-matchIds',`${p}?spaceId=${SPACE}&matchIds=${SYNTH_MATCH}`]
 );}
 for(const [label,url] of matchTests)await probe(label,url,h);
}
main().catch(()=>log('unexpected_error'));
