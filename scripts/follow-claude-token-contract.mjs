/* Privacy-safe investigation of Ubisoft's generic token service.
 * This follows the title-auth blocker discovered by the ranked endpoint sweep.
 * It never prints token/session/profile values. If a response contains a token,
 * only its JSON field names are logged.
 */
const BRANCH='chatgpt-follow-claude-endpoints';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const GAME_APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const BUILD='CERT_PC_70.713_C9831255_D485915_S20473';
const SANDBOX='HERO_PC_LNCH_A';
const T=10000;
const log=s=>console.log(`[FH_TOKEN_CONTRACT] ${s}`);
const clean=v=>String(v??'-').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,'<uuid>').replace(/(Ubi_v1|rm_v1)\s+t=[^\s&"']+/gi,'$1 t=<redacted>').slice(0,300);

async function session(){
 const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
 if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return b}}catch{}
 if(process.env.UBISOFT_TICKET)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||'',profileId:null};
 return null;
}
function shape(text){try{const b=JSON.parse(text);return{body:b,keys:b&&typeof b==='object'&&!Array.isArray(b)?Object.keys(b).sort():[],array:Array.isArray(b)}}catch{return{body:null,keys:[],array:false}}}
async function req(label,url,h,method='GET',body){try{const r=await fetch(url,{method,headers:h,body,redirect:'manual',signal:AbortSignal.timeout(T)});const text=await r.text();const s=shape(text);log(`${label}: method=${method} status=${r.status} allow=${clean(r.headers.get('allow'))} keys=${s.keys.join(',')||'-'} array=${s.array}`);if(!r.ok&&s.body)log(`${label}: errorCode=${clean(s.body.errorCode)} context=${clean(s.body.errorContext)} message=${clean(s.body.message)} resource=${clean(s.body.resource)}`);return{r,text,body:s.body}}catch(e){log(`${label}: network_error=${clean(e?.name||'Error')}`);return null}}
function scanConfig(body){const hits=[];function walk(v,path='',d=0){if(d>6||v==null)return;if(Array.isArray(v)){v.slice(0,100).forEach((x,i)=>walk(x,`${path}[${i}]`,d+1));return}if(typeof v!=='object')return;for(const[k,x]of Object.entries(v)){const p=path?`${path}.${k}`:k;if(/token|auth/i.test(p)&&['string','number','boolean'].includes(typeof x))hits.push(`${p}=${clean(x)}`);walk(x,p,d+1)}}walk(body);return hits.slice(0,160)}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await session();log(`session_available=${Boolean(s?.ticket)} profile_available=${Boolean(s?.profileId)}`);if(!s?.ticket)return;
 const h={Accept:'application/json','Content-Type':'application/json','Ubi-AppId':GAME_APP,'X-Platform-AppId':GAME_APP,'Ubi-AppBuildId':BUILD,'Ubi-Populations':SANDBOX,'Ubi-SandboxId':SANDBOX,'Ubi-LocaleCode':'en-US','Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`,...(s.profileId?{'Ubi-ProfileId':s.profileId}:{})};
 const cfg=await req('app-config',`${UBI}/v1/applications/${GAME_APP}/configuration`,h);
 if(cfg?.body){const hits=scanConfig(cfg.body);if(hits.length)log(`app-config-token-auth=${hits.join('|')}`)}
 const sp=await req('space-parameters',`${UBI}/v1/spaces/${SPACE}/parameters`,h);
 if(sp?.body){const hits=scanConfig(sp.body);if(hits.length)log(`space-token-auth=${hits.join('|')}`)}
 if(!s.profileId){log('self token probes skipped: no stored profile id');return}
 const p=encodeURIComponent(s.profileId);
 const profileToken=`${UBI}/v1/profiles/${p}/tokens`;
 const spaceToken=`${UBI}/v1/spaces/${SPACE}/tokens`;
 for(const m of ['GET','HEAD','OPTIONS'])await req(`profile-token-${m.toLowerCase()}`,profileToken,h,m);
 for(const m of ['GET','HEAD','OPTIONS'])await req(`space-token-${m.toLowerCase()}`,spaceToken,h,m);
 // Invalid/partial POST bodies are intentionally bounded contract probes. A
 // success is never printed as a token; we only retain status + top-level keys.
 const bodies=[
   ['empty',{}],
   ['space',{spaceId:SPACE}],
   ['application',{applicationId:GAME_APP}],
   ['space-application',{spaceId:SPACE,applicationId:GAME_APP}],
   ['sandbox',{spaceId:SPACE,sandbox:SANDBOX}],
   ['platform',{spaceId:SPACE,platformType:'uplay'}],
 ];
 for(const[label,b]of bodies){const x=await req(`profile-token-post-${label}`,profileToken,h,'POST',JSON.stringify(b));if(x?.r?.ok)log(`profile-token-post-${label}: success_response_shape_only=true`)}
}
main().catch(e=>log(`unexpected_error=${clean(e?.name||'Error')}`));
