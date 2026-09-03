/* Refined privacy-safe scan of current public For Honor config/playlists.
 * Excludes map worldDivision noise and prints only rank-system metadata.
 */
const BRANCH='chatgpt-ranked-history-research';
const UBI='https://public-ubiservices.ubi.com';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const T=12000;
const log=s=>console.log(`[FH_REFINED_RANK] ${s}`);
const keyRe=/(leaderboard|rank(?:ed|ing|points?|id|type|level|tier|division|season)?|skillfamily|skillrating|placement|promotion|demotion|grandmaster|master|platinum|diamond|bronze|silver|gold|recipeid|playlistid)/i;
const valueRe=/(leaderboard|rank points?|grandmaster|master|platinum|diamond|bronze|silver|gold|promotion|demotion|placement|season 0)/i;
function clean(v){return String(v).replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,'<uuid>').slice(0,500)}
async function sess(){
 if(process.env.UBISOFT_TICKET)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||''};
 const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
 if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return{ticket:b.ticket,sessionId:b.sessionId||''}}}catch{}
 const uu=process.env.UPSTASH_REDIS_REST_URL,ut=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(uu&&ut)try{const r=await fetch(uu,{method:'POST',headers:{Authorization:`Bearer ${ut}`,'Content-Type':'application/json'},body:JSON.stringify(['GET','ubisoft:session']),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();const x=b?.result?JSON.parse(b.result):null;if(x?.ticket)return{ticket:x.ticket,sessionId:x.sessionId||''}}}catch{}
 return null;
}
function scan(v,path='',out=[]){
 if(out.length>=500)return out;
 if(Array.isArray(v)){for(let i=0;i<v.length;i++)scan(v[i],`${path}[${i}]`,out);return out}
 if(v&&typeof v==='object'){
   for(const [k,x] of Object.entries(v)){
     const p=path?`${path}.${k}`:k;
     if(/worldDivision/i.test(k)){continue}
     if(keyRe.test(k)||(typeof x==='string'&&valueRe.test(x))){
       if(x==null||typeof x!=='object')out.push([p,x]);
       else out.push([p,Array.isArray(x)?`<array:${x.length}>`:`<object:${Object.keys(x).slice(0,20).join(',')}>`]);
     }
     scan(x,p,out); if(out.length>=500)break;
   }
 }
 return out;
}
async function get(url,h={}){try{const r=await fetch(url,{headers:h,signal:AbortSignal.timeout(T)});const text=await r.text();let b=null;try{b=JSON.parse(text)}catch{};return{status:r.status,b,text}}catch{return null}}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await sess();log(`session_available=${Boolean(s?.ticket)}`);if(!s?.ticket)return;
 const h={Accept:'application/json','Ubi-AppId':APP,'X-Platform-AppId':APP,'Ubi-SessionId':s.sessionId||'','Ubi-LocaleCode':'en-US',Authorization:`Ubi_v1 t=${s.ticket}`};
 const p=await get(`${UBI}/v1/spaces/${SPACE}/parameters`,h);log(`space-parameters: status=${p?.status??'ERR'}`);
 if(p?.b){const hits=scan(p.b);log(`space-parameters: hits=${hits.length}`);for(const [pp,x] of hits.slice(0,180))log(`space: ${clean(pp)}=${clean(x)}`)}
 const f=p?.b?.parameters?.['fh-configuration']?.fields||{};
 const host=f.hn_playlist_bundles_url||f.playlist_versions_url;
 const names=[f.hn_default_playlist_bundle_name,f.hn_next_playlist_bundle_name].filter(Boolean);
 log(`bundle_names=${names.map(clean).join(',')||'-'} host_available=${Boolean(host)}`);
 if(host)for(const name of [...new Set(names)]){
   const urls=[`${host.replace(/\/$/,'')}/fh-playlists-live/${name}`,`${host.replace(/\/$/,'')}/fh-playlists-live/${name}.json`,`${host.replace(/\/$/,'')}/${name}`,`${host.replace(/\/$/,'')}/${name}.json`];
   for(let i=0;i<urls.length;i++){const x=await get(urls[i],{Range:'bytes=0-1000000'});if(!x||!x.b)continue;log(`${clean(name)}: source_candidate=${i+1} status=${x.status}`);const hits=scan(x.b);log(`${clean(name)}: hits=${hits.length}`);for(const [pp,val] of hits.slice(0,260))log(`${clean(name)}: ${clean(pp)}=${clean(val)}`);break}
 }
}
main().catch(()=>log('unexpected_error=redacted'));
