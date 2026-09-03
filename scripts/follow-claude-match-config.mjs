/* Privacy-safe extraction of public For Honor UbiServices route configuration
 * relevant to match/activity history. Prints public route templates, feature
 * switches and notification names only; never player/session data.
 */
const BRANCH='chatgpt-follow-claude-endpoints';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const T=10000;
const log=s=>console.log(`[FH_MATCH_CONFIG] ${s}`);
async function sess(){const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return b}}catch{};return process.env.UBISOFT_TICKET?{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||''}:null}
function clean(v){return String(v??'-').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,'<uuid>').slice(0,500)}
async function main(){if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}const s=await sess();log(`session_available=${Boolean(s?.ticket)}`);if(!s?.ticket)return;const h={Accept:'application/json','Ubi-AppId':APP,'Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`};const r=await fetch(`${UBI}/v1/spaces/${SPACE}/parameters`,{headers:h,signal:AbortSignal.timeout(T)});log(`status=${r.status}`);if(!r.ok)return;const body=await r.json();const params=body?.parameters??{};
for(const groupName of ['us-sdkClientUrls','us-sdkClientFeaturesSwitches','us-sdkClientNotificationsInternal','us-sdkClientNotificationsGame','fh-configuration','fh-customFeatureSwitches']){const fields=params?.[groupName]?.fields??{};const hits=[];for(const[k,v]of Object.entries(fields)){const text=`${k} ${typeof v==='string'?v:''}`;if(/match|activity|arbitr|history|replay/i.test(text))hits.push(`${k}=${clean(v)}`)}if(hits.length)log(`${groupName}=${hits.join('|')}`)}
}
main().catch(e=>log(`unexpected_error=${e?.name||'Error'}`));
