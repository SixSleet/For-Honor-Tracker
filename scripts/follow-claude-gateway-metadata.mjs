/* Public metadata only: inspect registered UbiServices gateway resources for
 * activity/match/auth/rank names and versions. No player/session values logged.
 */
const BRANCH='chatgpt-follow-claude-endpoints';
const UBI='https://public-ubiservices.ubi.com';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const T=9000;
const log=s=>console.log(`[FH_GATEWAY_META] ${s}`);
async function sess(){const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return b}}catch{};return null}
function clean(v){return String(v??'-').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<uuid>').slice(0,600)}
async function main(){if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}const s=await sess();log(`session_available=${Boolean(s?.ticket)}`);if(!s?.ticket)return;const h={Accept:'application/json','Ubi-AppId':APP,'Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`};const r=await fetch(`${UBI}/v1/applications/${APP}/configuration`,{headers:h,signal:AbortSignal.timeout(T)});log(`status=${r.status}`);if(!r.ok)return;const b=await r.json();const resources=b?.configuration?.gatewayResources??[];for(const x of resources){const text=`${x?.name??''} ${x?.url??''}`;if(/activity|match|rank|leader|skill|token|oauth|auth/i.test(text)){const safe={name:x?.name,url:x?.url,version:x?.version,method:x?.method,methods:x?.methods,service:x?.service,resource:x?.resource};log(`resource=${clean(JSON.stringify(safe))}`)}}}
main().catch(e=>log(`unexpected_error=${e?.name||'Error'}`));
