/* Recursively extracts PUBLIC For Honor parameter/config fields relevant to
 * rank/auth/arbitration/history. Does not inspect or print account responses.
 */
const BRANCH='chatgpt-follow-claude-endpoints';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const T=10000;
const log=s=>console.log(`[FH_CONFIG_KEYWORDS] ${s}`);
async function sess(){const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return b}}catch{};return null}
function safe(v){const s=typeof v==='string'?v:JSON.stringify(v);return String(s??'-').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<uuid>').slice(0,700)}
const RX=/rank|league|division|season|leader|skill.?rating|arbitr|game2web|hero.?login|storm|onion|oauth|auth|token|match.?history|replay|recent.?match|result/i;
function collect(root){const out=[];function walk(v,p='',d=0){if(d>9||v==null)return;if(Array.isArray(v)){v.slice(0,200).forEach((x,i)=>walk(x,`${p}[${i}]`,d+1));return}if(typeof v!=='object')return;for(const[k,x]of Object.entries(v)){const q=p?`${p}.${k}`:k;if(RX.test(q)||RX.test(String(typeof x==='string'?x:''))){if(['string','number','boolean'].includes(typeof x)||x===null)out.push(`${q}=${safe(x)}`)}walk(x,q,d+1)}}walk(root);return [...new Set(out)].slice(0,450)}
async function main(){if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}const s=await sess();log(`session_available=${Boolean(s?.ticket)}`);if(!s?.ticket)return;const h={Accept:'application/json','Ubi-AppId':APP,'Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`};for(const[label,url]of [['space',`${UBI}/v1/spaces/${SPACE}/parameters`],['application',`${UBI}/v1/applications/${APP}/configuration`]]){const r=await fetch(url,{headers:h,signal:AbortSignal.timeout(T)});log(`${label}: status=${r.status}`);if(!r.ok)continue;const b=await r.json();const hits=collect(b);log(`${label}: hit_count=${hits.length}`);for(const x of hits)log(`${label}: ${x}`)}}
main().catch(e=>log(`unexpected_error=${e?.name||'Error'}`));
