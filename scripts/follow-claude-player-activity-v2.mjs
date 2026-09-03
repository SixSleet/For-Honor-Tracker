/* Refined privacy-safe PlayerActivity contract probe.
 * Tests v1/v2 and the requirements exposed by the first run: locale and
 * spaceId. Logs schemas only, never activity values or profile identifiers.
 */
const BRANCH='chatgpt-follow-claude-endpoints';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const T=9000;
const log=s=>console.log(`[FH_PLAYER_ACTIVITY_V2] ${s}`);
async function sess(){const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return b}}catch{};return null}
function clean(v){return String(v??'-').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<uuid>').replace(/\b\d{12,}\b/g,'<id>').slice(0,220)}
function shape(text){try{const b=JSON.parse(text),paths=new Set(),arrays=[];function walk(v,p='',d=0){if(d>6||v==null)return;if(Array.isArray(v)){arrays.push(`${p||'<root>'}:${v.length}`);if(v[0]!==undefined)walk(v[0],`${p}[]`,d+1);return}if(typeof v!=='object')return;for(const k of Object.keys(v).sort().slice(0,120)){const q=p?`${p}.${k}`:k;paths.add(q);walk(v[k],q,d+1)}}walk(b);return{b,keys:b&&typeof b==='object'&&!Array.isArray(b)?Object.keys(b).sort():[],paths:[...paths].slice(0,220),arrays:arrays.slice(0,50)}}catch{return{b:null,keys:[],paths:[],arrays:[]}}}
async function req(label,url,h){try{const r=await fetch(url,{headers:h,redirect:'manual',signal:AbortSignal.timeout(T)});const text=await r.text();const s=shape(text);log(`${label}: status=${r.status} keys=${s.keys.join(',')||'-'}`);if(r.ok){log(`${label}: schema=${s.paths.join('|')||'-'}`);log(`${label}: arrays=${s.arrays.join('|')||'-'}`)}else if(s.b)log(`${label}: context=${clean(s.b.errorContext)} code=${clean(s.b.errorCode)} message=${clean(s.b.message)}`);return{r,s}}catch(e){log(`${label}: network_error=${e?.name||'Error'}`)}}
async function main(){if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}const s=await sess();log(`session_available=${Boolean(s?.ticket)} profile_available=${Boolean(s?.profileId)}`);if(!s?.ticket||!s?.profileId)return;const h={Accept:'application/json','Content-Type':'application/json','Ubi-AppId':APP,'Ubi-LocaleCode':'en-US','Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`};const p=encodeURIComponent(s.profileId);
for(const v of [1,2]){
 const profile=`${UBI}/v${v}/profiles/${p}/playeractivities/activities`;
 const contexts=`${UBI}/v${v}/profiles/${p}/playeractivitycontexts`;
 const space=`${UBI}/v${v}/spaces/${SPACE}/playeractivities/activities`;
 const variants=[['profile-base',profile],['profile-space-q',`${profile}?spaceId=${SPACE}`],['profile-space-limit',`${profile}?spaceId=${SPACE}&limit=10`],['profile-space-offset',`${profile}?spaceId=${SPACE}&offset=0&limit=10`],['profile-space-closed',`${profile}?spaceId=${SPACE}&status=closed`],['profile-space-context',`${profile}?spaceId=${SPACE}&context=match`],['contexts-space',`${contexts}?spaceId=${SPACE}`],['space-base',space],['space-limit',`${space}?limit=10`],['space-status-closed',`${space}?status=closed`]];
 for(const[l,u]of variants)await req(`v${v}-${l}`,u,h);
 }
}
main().catch(e=>log(`unexpected_error=${e?.name||'Error'}`));
