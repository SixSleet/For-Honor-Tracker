/* Focused, privacy-safe probe for UbiServices generic leaderboard resources.
 * Tests only routes explicitly advertised by the current For Honor application
 * configuration, with SDK-style headers. Logs no account/session values.
 */
const BRANCH='chatgpt-ranked-history-research';
const UBI='https://public-ubiservices.ubi.com';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const CROSS='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const LEGACY='882ad5b5-f549-44a1-a434-c465d22fe4bf';
const BUILD='CERT_PC_70.713_C9831255_D485915_S20473';
const T=12000;
const log=s=>console.log(`[FH_GENERIC_RANK] ${s}`);
async function sess(){
 if(process.env.UBISOFT_TICKET)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||'',profileId:process.env.UBISOFT_PROFILE_ID||''};
 const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
 if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return{ticket:b.ticket,sessionId:b.sessionId||'',profileId:b.profileId||''}}}catch{}
 const uu=process.env.UPSTASH_REDIS_REST_URL,ut=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(uu&&ut)try{const r=await fetch(uu,{method:'POST',headers:{Authorization:`Bearer ${ut}`,'Content-Type':'application/json'},body:JSON.stringify(['GET','ubisoft:session']),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();const x=b?.result?JSON.parse(b.result):null;if(x?.ticket)return{ticket:x.ticket,sessionId:x.sessionId||'',profileId:x.profileId||''}}}catch{}
 return null;
}
function clean(s){return String(s).replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,'<uuid>').slice(0,260)}
function meta(text){try{const b=JSON.parse(text);const keys=b&&typeof b==='object'&&!Array.isArray(b)?Object.keys(b).sort():[];return{b,keys}}catch{return{b:null,keys:[]}}}
async function req(label,url,h){try{const r=await fetch(url,{headers:h,redirect:'manual',signal:AbortSignal.timeout(T)});const text=(await r.text()).slice(0,300000);const m=meta(text);const ec=m.b?.errorContext??'-', code=m.b?.errorCode??'-', msg=typeof m.b?.message==='string'?clean(m.b.message):'-';log(`${label}: status=${r.status} keys=${m.keys.join(',')||'-'} errorContext=${clean(ec)} errorCode=${clean(code)} message=${msg}`);if(r.ok){const paths=[];const walk=(v,p='',d=0)=>{if(d>3||v==null||typeof v!=='object'||paths.length>100)return;if(Array.isArray(v)){paths.push(`${p}[${v.length}]`);if(v[0])walk(v[0],`${p}[]`,d+1);return}for(const k of Object.keys(v).sort()){const q=p?`${p}.${k}`:k;paths.push(q);walk(v[k],q,d+1)}};walk(m.b);log(`${label}: schema=${paths.slice(0,100).join('|')||'-'}`)}return{status:r.status,body:m.b}}catch(e){log(`${label}: network_error=${e?.name||'Error'}`);return null}}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await sess();log(`session_available=${Boolean(s?.ticket)} profile_available=${Boolean(s?.profileId)}`);if(!s?.ticket)return;
 const h={Accept:'application/json','Content-Type':'application/json','Ubi-AppId':APP,'X-Platform-AppId':APP,'Ubi-AppBuildId':BUILD,'Ubi-Populations':'US_EMPTY_VALUE','Ubi-LocaleCode':'en-US','Ubi-SessionId':s.sessionId||'',...(s.profileId?{'Ubi-ProfileId':s.profileId}:{}),Authorization:`Ubi_v1 t=${s.ticket}`,'User-Agent':'UbiServices_SDK_PC64'};
 // First read current app configuration and report only the three leaderboard resource records.
 const cfg=await fetch(`${UBI}/v1/applications/${APP}/configuration`,{headers:h,signal:AbortSignal.timeout(T)});let cj=null;try{cj=await cfg.json()}catch{};const resources=cj?.configuration?.gatewayResources||[];for(const x of resources.filter(x=>/leaderboard/i.test(String(x?.name||''))))log(`registered: name=${clean(x.name)} version=${clean(x.version??'-')} url=${clean(x.url??'-')}`);
 // Exact generic paths advertised by the application. No guessed suffixes.
 for(const v of [1,2]){
   await req(`v${v}-me-ranks-bare`,`${UBI}/v${v}/profiles/me/ranks`,h);
   if(s.profileId)await req(`v${v}-profiles-ranks-self`,`${UBI}/v${v}/profiles/ranks?profileIds=${encodeURIComponent(s.profileId)}`,h);
   await req(`v${v}-cross-space-leaderboards-bare`,`${UBI}/v${v}/spaces/${CROSS}/leaderboards`,h);
   await req(`v${v}-legacy-space-leaderboards-bare`,`${UBI}/v${v}/spaces/${LEGACY}/leaderboards`,h);
 }
}
main().catch(()=>log('unexpected_error=redacted'));
