/* Resolve For Honor's live {baseurl_aws} placeholder and test only the
 * leaderboard URLs Ubisoft advertises in the same configuration.
 * Privacy-safe: no profile IDs, tickets, session IDs, or response values logged.
 */
const BRANCH='chatgpt-follow-claude-endpoints-v2';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const T=10000;
const log=s=>console.log(`[FH_LB_BASE] ${s}`);
const clean=v=>String(v??'-').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<uuid>').replace(/\b\d{12,}\b/g,'<id>').slice(0,280);
async function sess(){
  if(process.env.UBISOFT_TICKET)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||''};
  const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
  if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return b}}catch{}
  return null;
}
function findField(root,target){let found=null;function walk(v,d=0){if(found!==null||d>9||v==null||typeof v!=='object')return;if(Array.isArray(v)){for(const x of v)walk(x,d+1);return}for(const[k,x]of Object.entries(v)){if(k===target){found=x;return}walk(x,d+1)}}walk(root);return found}
function selectStandard(v){if(typeof v==='string')return v;if(v&&typeof v==='object'){for(const k of ['Standard','standard','Prod','prod','Default','default'])if(typeof v[k]==='string')return v[k];const first=Object.values(v).find(x=>typeof x==='string');if(first)return first}return null}
function shape(text){try{const b=JSON.parse(text);const keys=b&&typeof b==='object'&&!Array.isArray(b)?Object.keys(b).sort().slice(0,30):[];const paths=new Set();const walk=(v,p='',d=0)=>{if(d>2||v==null)return;if(Array.isArray(v)){if(v[0]!==undefined)walk(v[0],`${p}[]`,d+1);return}if(typeof v!=='object')return;for(const k of Object.keys(v).sort().slice(0,40)){const n=p?`${p}.${k}`:k;paths.add(n);walk(v[k],n,d+1)}};walk(b);return{b,keys,paths:[...paths].slice(0,70)}}catch{return{b:null,keys:[],paths:[]}}}
async function req(label,url,h){try{const r=await fetch(url,{headers:h,redirect:'manual',signal:AbortSignal.timeout(T)});const text=await r.text();const s=shape(text);log(`${label}: status=${r.status} keys=${s.keys.join(',')||'-'}`);if(r.ok)log(`${label}: schema=${s.paths.join('|')||'-'}`);else if(s.b)log(`${label}: code=${clean(s.b.errorCode)} context=${clean(s.b.errorContext)} message=${clean(s.b.message)}`)}catch(e){log(`${label}: network_error=${clean(e?.name||'Error')}`)}}
async function main(){
  if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
  const s=await sess();log(`session_available=${Boolean(s?.ticket)}`);if(!s?.ticket)return;
  const h={Accept:'application/json','Ubi-AppId':APP,'X-Platform-AppId':APP,'Ubi-LocaleCode':'en-US','Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`};
  const r=await fetch(`${UBI}/v1/spaces/${SPACE}/parameters`,{headers:h,signal:AbortSignal.timeout(T)});log(`parameters_status=${r.status}`);if(!r.ok)return;const p=await r.json();
  const raw=findField(p,'baseurl_aws');const base=selectStandard(raw);log(`baseurl_aws_present=${Boolean(base)}`);if(!base)return;
  const normalized=base.replace('{env}','').replace(/\/$/,'');
  let host='invalid';try{host=new URL(normalized).host}catch{}
  log(`baseurl_aws_host=${clean(host)}`);
  const profiles=normalized+'/v1/profiles/ranks';
  const me=normalized+'/v1/profiles/me/ranks';
  const spaces=normalized+`/v1/spaces/${SPACE}/leaderboards`;
  await req('profiles-ranks-base',profiles,h);
  await req('profiles-ranks-space',profiles+`?spaceId=${SPACE}`,h);
  await req('me-ranks-base',me,h);
  await req('me-ranks-space',me+`?spaceId=${SPACE}`,h);
  await req('space-leaderboards-base',spaces,h);
}
main().catch(e=>log(`unexpected_error=${clean(e?.name||'Error')}`));
