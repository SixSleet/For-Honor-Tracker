/* Privacy-safe inspection of current For Honor application/space configuration
 * around ranking resources. Prints only public configuration metadata.
 */
const BRANCH='chatgpt-ranked-history-research';
const UBI='https://public-ubiservices.ubi.com';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const T=12000;
const log=s=>console.log(`[FH_RANK_META] ${s}`);
async function sess(){
 if(process.env.UBISOFT_TICKET)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||''};
 const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
 if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return{ticket:b.ticket,sessionId:b.sessionId||''}}}catch{}
 const uu=process.env.UPSTASH_REDIS_REST_URL,ut=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(uu&&ut)try{const r=await fetch(uu,{method:'POST',headers:{Authorization:`Bearer ${ut}`,'Content-Type':'application/json'},body:JSON.stringify(['GET','ubisoft:session']),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();const x=b?.result?JSON.parse(b.result):null;if(x?.ticket)return{ticket:x.ticket,sessionId:x.sessionId||''}}}catch{}
 return null;
}
function clean(v){return String(v).replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,'<uuid>').slice(0,800)}
function dump(label,obj,path='',depth=0){if(depth>5||obj==null)return;if(Array.isArray(obj)){log(`${label}${path}: <array:${obj.length}>`);for(let i=0;i<Math.min(obj.length,20);i++)dump(label,obj[i],`${path}[${i}]`,depth+1);return}if(typeof obj==='object'){for(const [k,v] of Object.entries(obj)){const p=path?`${path}.${k}`:`.${k}`;if(v==null||typeof v!=='object')log(`${label}${p}=${clean(v)}`);else dump(label,v,p,depth+1)}return}}
async function json(url,h){try{const r=await fetch(url,{headers:h,signal:AbortSignal.timeout(T)});const b=await r.json();return{status:r.status,b}}catch{return null}}
async function methodProbe(label,url,h,method){try{const r=await fetch(url,{method,headers:h,redirect:'manual',signal:AbortSignal.timeout(T)});const text=await r.text();let b=null;try{b=JSON.parse(text)}catch{};log(`${label}: method=${method} status=${r.status} allow=${clean(r.headers.get('allow')||'-')} www_auth=${clean(r.headers.get('www-authenticate')||'-')} keys=${b&&typeof b==='object'?Object.keys(b).sort().join(','):'-'}`);if(b&&!r.ok)log(`${label}: errorCode=${clean(b.errorCode??'-')} context=${clean(b.errorContext??'-')} message=${clean(b.message??'-')} resource=${clean(b.resource??'-')}`)}catch(e){log(`${label}: method=${method} network_error=${e?.name||'Error'}`)}}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await sess();log(`session_available=${Boolean(s?.ticket)}`);if(!s?.ticket)return;
 const h={Accept:'application/json','Ubi-AppId':APP,'X-Platform-AppId':APP,'Ubi-SessionId':s.sessionId||'','Ubi-LocaleCode':'en-US',Authorization:`Ubi_v1 t=${s.ticket}`};
 const app=await json(`${UBI}/v1/applications/${APP}/configuration`,h);log(`app_config_status=${app?.status??'ERR'}`);
 const resources=app?.b?.configuration?.gatewayResources||[];
 for(const r of resources.filter(x=>/(leaderboard|rank|skill)/i.test(String(x?.name||''))||/(leaderboard|rank|skill)/i.test(String(x?.url||'')))){log(`resource_begin name=${clean(r.name||'-')}`);dump('resource',r);log('resource_end')}
 const sp=await json(`${UBI}/v1/spaces/${SPACE}/parameters`,h);log(`space_parameters_status=${sp?.status??'ERR'}`);
 const groups=sp?.b?.parameters||{};
 for(const [g,v] of Object.entries(groups)){
   const text=JSON.stringify(v);
   if(/heroranking|skillrating|heroleaderboard|leaderboard/i.test(text)){log(`group_begin=${clean(g)}`);const fields=v?.fields||{};for(const [k,x] of Object.entries(fields)){if(/rank|skill|leader/i.test(k)||/heroranking|skillrating|heroleaderboard|leaderboard/i.test(String(x)))log(`group ${clean(g)}.${clean(k)}=${clean(x)}`)}log(`group_end=${clean(g)}`)}
 }
 // Method behavior for the one proven title route; no parameter guessing.
 const player=`${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/heroranking/public/v1/player`;
 for(const m of ['GET','HEAD','POST','PUT','PATCH','DELETE'])await methodProbe('heroranking-v1-player',player,h,m);
}
main().catch(()=>log('unexpected_error=redacted'));
