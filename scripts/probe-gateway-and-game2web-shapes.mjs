/* Privacy-safe route mapping. Tests only public/documented Ubisoft gateway hosts
 * and synthetic-profile path shapes. No real profile IDs or response values logged.
 */
const BRANCH='chatgpt-follow-claude-endpoints-v2';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const SYN='00000000-0000-4000-8000-000000000000';
const T=10000;
const log=s=>console.log(`[FH_GATEWAY_SHAPES] ${s}`);
const clean=v=>String(v??'-').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<uuid>').replace(/\b\d{12,}\b/g,'<id>').slice(0,260);
async function sess(){
  if(process.env.UBISOFT_TICKET)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||''};
  const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
  if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return b}}catch{}
  return null;
}
function shape(text){try{const b=JSON.parse(text);return{b,keys:b&&typeof b==='object'&&!Array.isArray(b)?Object.keys(b).sort().slice(0,25):[]}}catch{return{b:null,keys:[]}}}
async function req(label,url,h){try{const r=await fetch(url,{headers:h,redirect:'manual',signal:AbortSignal.timeout(T)});const text=await r.text();const s=shape(text);log(`${label}: status=${r.status} host=${clean(new URL(url).host)} keys=${s.keys.join(',')||'-'}`);if(!r.ok&&s.b)log(`${label}: code=${clean(s.b.errorCode)} context=${clean(s.b.errorContext)} message=${clean(s.b.message)} resource=${clean(s.b.resource)}`)}catch(e){log(`${label}: network_error=${clean(e?.name||'Error')}`)}}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await sess();log(`session_available=${Boolean(s?.ticket)}`);if(!s?.ticket)return;
 const h={Accept:'application/json','Ubi-AppId':APP,'X-Platform-AppId':APP,'Ubi-LocaleCode':'en-US','Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`};
 const hosts=['public-ubiservices.ubi.com','public.aws-ubiservices.ubi.com','useast1-public.aws-ubiservices.ubi.com','msr-public-ubiservices.ubi.com'];
 for(const host of hosts){
   const base=`https://${host}`;
   await req(`rank-${host}`,`${base}/v1/profiles/ranks`,h);
   await req(`rank-space-${host}`,`${base}/v1/profiles/ranks?spaceId=${SPACE}`,h);
   await req(`space-lb-${host}`,`${base}/v1/spaces/${SPACE}/leaderboards`,h);
 }
 const root=`https://public-ubiservices.ubi.com/v1/spaces/${SPACE}/title/hero/hero-live/game2web/public/v1/`;
 const paths=[
   `profiles/${SYN}/stats`,`profiles/${SYN}/statistics`,`profiles/${SYN}/ranking`,`profiles/${SYN}/rank`,
   `players/${SYN}/stats`,`players/${SYN}/statistics`,`players/${SYN}/ranking`,`players/${SYN}/rank`,
   `profile/${SYN}/stats`,`profile/${SYN}/ranking`,`player/${SYN}/stats`,`player/${SYN}/ranking`,
   `profiles/stats`,`profiles/ranking`,`players/stats`,`players/ranking`
 ];
 for(const p of paths)await req(`g2w-${p.replaceAll(SYN,'id').replaceAll('/','-')}`,root+p,h);
}
main().catch(e=>log(`unexpected_error=${clean(e?.name||'Error')}`));
