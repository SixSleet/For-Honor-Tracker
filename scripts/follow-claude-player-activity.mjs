/* Privacy-safe player-activity contract probe.
 * The live For Honor space advertises playerActivity plus CLOSED/CREATED/UPDATED
 * notifications. We inspect only HTTP behavior and response schema, never ids,
 * usernames, timestamps or values.
 */
const BRANCH='chatgpt-follow-claude-endpoints';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const SYN='00000000-0000-4000-8000-000000000000';
const T=9000;
const log=s=>console.log(`[FH_PLAYER_ACTIVITY] ${s}`);
async function sess(){const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return b}}catch{};return process.env.UBISOFT_TICKET?{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||'',profileId:null}:null}
function schema(text){try{const b=JSON.parse(text),paths=new Set();let arrayLengths=[];function walk(v,p='',d=0){if(d>5||v==null)return;if(Array.isArray(v)){arrayLengths.push(`${p || '<root>'}:${v.length}`);if(v[0]!==undefined)walk(v[0],`${p}[]`,d+1);return}if(typeof v!=='object')return;for(const k of Object.keys(v).sort().slice(0,100)){const q=p?`${p}.${k}`:k;paths.add(q);walk(v[k],q,d+1)}}walk(b);return{b,paths:[...paths].slice(0,160),arrays:arrayLengths.slice(0,40),keys:b&&typeof b==='object'&&!Array.isArray(b)?Object.keys(b).sort():[]}}catch{return{b:null,paths:[],arrays:[],keys:[]}}}
function clean(v){return String(v??'-').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<uuid>').replace(/\b\d{12,}\b/g,'<id>').slice(0,250)}
async function req(label,url,h,method='GET'){try{const r=await fetch(url,{method,headers:h,redirect:'manual',signal:AbortSignal.timeout(T)});const text=await r.text();const s=schema(text);log(`${label}: method=${method} status=${r.status} allow=${clean(r.headers.get('allow'))} keys=${s.keys.join(',')||'-'}`);if(r.ok){log(`${label}: schema=${s.paths.join('|')||'-'}`);log(`${label}: arrays=${s.arrays.join('|')||'-'}`)}else if(s.b)log(`${label}: context=${clean(s.b.errorContext)} code=${clean(s.b.errorCode)} message=${clean(s.b.message)}`);return{r,s}}catch(e){log(`${label}: network_error=${e?.name||'Error'}`);return null}}
async function main(){if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}const s=await sess();log(`session_available=${Boolean(s?.ticket)} profile_available=${Boolean(s?.profileId)}`);if(!s?.ticket)return;const h={Accept:'application/json','Content-Type':'application/json','Ubi-AppId':APP,'Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`};const base=id=>`${UBI}/v1/profiles/${encodeURIComponent(id)}/playeractivities/activities`;if(s.profileId){const p=base(s.profileId);for(const[label,q]of [['base',''],['space',`?spaceId=${SPACE}`],['limit','?limit=10'],['offset-limit','?offset=0&limit=10'],['closed','?status=closed'],['space-closed',`?spaceId=${SPACE}&status=closed`],['types','?activityTypes=match'],['locale','?locale=en-US']])await req(`self-${label}`,p+q,h);await req('self-head',p,h,'HEAD');await req('self-options',p,h,'OPTIONS');await req('self-contexts',`${UBI}/v1/profiles/${encodeURIComponent(s.profileId)}/playeractivitycontexts`,h)}
const syn=base(SYN);await req('synthetic-profile',syn,h);await req('synthetic-profile-space',`${syn}?spaceId=${SPACE}`,h);await req('space-activities',`${UBI}/v1/spaces/${SPACE}/playeractivities/activities`,h);await req('space-activities-limit',`${UBI}/v1/spaces/${SPACE}/playeractivities/activities?limit=10`,h)
}
main().catch(e=>log(`unexpected_error=${e?.name||'Error'}`));
