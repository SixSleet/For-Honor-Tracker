/* Privacy-safe scan of live For Honor configuration for staged Ranked schema.
 * Prints only public configuration paths/scalars. No profile/session/account values.
 */
const BRANCH='chatgpt-ranked-history-research';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const GAME_APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const T=12000;
const log=s=>console.log(`[FH_STAGED_RANK] ${s}`);
const terms=/(rank(?:ed|ing|point|points)?|division|bronze|silver|gold|platinum|diamond|grandmaster|master|skillfamily|skillrating|leaderboard|placement|promotion|demotion|season\s*0|rank[_-]?points?)/i;
function clean(v){return String(v).replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,'<uuid>').slice(0,700)}
async function sess(){
 if(process.env.UBISOFT_TICKET)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||''};
 const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
 if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return{ticket:b.ticket,sessionId:b.sessionId||''}}}catch{}
 const uu=process.env.UPSTASH_REDIS_REST_URL,ut=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(uu&&ut)try{const r=await fetch(uu,{method:'POST',headers:{Authorization:`Bearer ${ut}`,'Content-Type':'application/json'},body:JSON.stringify(['GET','ubisoft:session']),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();const x=b?.result?JSON.parse(b.result):null;if(x?.ticket)return{ticket:x.ticket,sessionId:x.sessionId||''}}}catch{}
 return null;
}
function walk(x,path='',out=[]){
 if(out.length>=300)return out;
 if(Array.isArray(x)){x.forEach((v,i)=>walk(v,`${path}[${i}]`,out));return out}
 if(x&&typeof x==='object'){for(const [k,v] of Object.entries(x)){const p=path?`${path}.${k}`:k;if(terms.test(k)||(typeof v==='string'&&terms.test(v)))out.push([p,typeof v==='object'?`<${Array.isArray(v)?'array':'object'}>`:v]);walk(v,p,out);if(out.length>=300)break}return out}
 return out;
}
async function get(label,url,headers={}){try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(T)});const text=await r.text();log(`${label}: status=${r.status} bytes=${text.length}`);let b=null;try{b=JSON.parse(text)}catch{};return{r,b,text}}catch(e){log(`${label}: network_error=${e?.name||'Error'}`);return null}}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await sess();log(`session_available=${Boolean(s?.ticket)}`);if(!s?.ticket)return;
 const h={Accept:'application/json','Ubi-AppId':GAME_APP,'X-Platform-AppId':GAME_APP,'Ubi-SessionId':s.sessionId||'','Ubi-LocaleCode':'en-US',Authorization:`Ubi_v1 t=${s.ticket}`};
 const sources=[
  ['space-parameters',`${UBI}/v1/spaces/${SPACE}/parameters`],
  ['game-app-parameters',`${UBI}/v1/applications/${GAME_APP}/parameters`],
  ['game-app-configuration',`${UBI}/v1/applications/${GAME_APP}/configuration`],
 ];
 for(const [label,url] of sources){const x=await get(label,url,h);if(!x?.b)continue;const hits=walk(x.b);log(`${label}: ranked_hits=${hits.length}`);for(const [p,v] of hits.slice(0,220))log(`${label}: ${clean(p)}=${clean(v)}`)}
 // Public current/next playlist bundle names and content are discovered from space parameters.
 const p=await get('playlist-source-parameters',`${UBI}/v1/spaces/${SPACE}/parameters`,h);const fields=p?.b?.parameters?.['fh-configuration']?.fields||{};
 const host=fields.hn_playlist_bundles_url||fields.playlist_versions_url;const names=[fields.hn_default_playlist_bundle_name,fields.hn_next_playlist_bundle_name].filter(Boolean);
 if(host)for(const name of [...new Set(names)]){
   const candidates=[`${host.replace(/\/$/,'')}/fh-playlists-live/${name}`,`${host.replace(/\/$/,'')}/fh-playlists-live/${name}.json`,`${host.replace(/\/$/,'')}/${name}`,`${host.replace(/\/$/,'')}/${name}.json`];
   for(let i=0;i<candidates.length;i++){const x=await get(`playlist-${name}-${i+1}`,candidates[i],{Range:'bytes=0-1000000'});if(!x?.b)continue;const hits=walk(x.b);log(`playlist-${name}: ranked_hits=${hits.length}`);for(const [pp,v] of hits.slice(0,180))log(`playlist-${name}: ${clean(pp)}=${clean(v)}`);break}
 }
}
main().catch(()=>log('unexpected_error=redacted'));
